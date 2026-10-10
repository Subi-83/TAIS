import asyncio
import time
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.models.requests import InferenceRequest

router = APIRouter(prefix="/api/fault-recovery", tags=["development"])

PHASES = [
    ("baseline", 0),
    ("fault_initiation", 200),
    ("fault_peak", 600),
    ("recovery", 100),
    ("stable_post_recovery", 0),
]


class FaultRunCreate(BaseModel):
    requests_per_phase: int = Field(default=3, ge=1, le=20)
    model: str = "mock-echo-1"


async def set_fault(request: Request, latency_ms: int) -> None:
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.put(f"{request.app.state.settings.mock_backend_url.rstrip('/')}/dev/faults", json={"latency_ms": latency_ms, "failure_rate": 0, "unhealthy": False})
        response.raise_for_status()


@router.get("/latest")
async def latest(request: Request) -> dict:
    result = request.app.state.repository.latest_fault_observations()
    return result or {"run_id": None, "observations": [], "message": "No fault-and-recovery experiment has been run"}


@router.post("")
async def run_fault_recovery(payload: FaultRunCreate, request: Request) -> dict:
    settings = request.app.state.settings
    if not settings.enable_dev_fault_injection or settings.inference_mode != "mock":
        raise HTTPException(status_code=404, detail="development fault experiment is unavailable")
    run_id = str(uuid4())
    observations = []
    try:
        for policy in ("fifo", "token_aware"):
            experiment_id = str(uuid4())
            for order, (phase, delay) in enumerate(PHASES):
                phase_started = datetime.now(UTC).isoformat()
                await set_fault(request, delay)
                queue_before = len(request.app.state.gateway.scheduler.pending)
                started = time.monotonic()
                jobs = [asyncio.create_task(request.app.state.gateway.submit(InferenceRequest(model=payload.model, prompt=f"{phase} request {index}", max_output_tokens=20, expected_output_tokens=20, scheduler_policy=policy, experiment_id=experiment_id))) for index in range(payload.requests_per_phase)]
                results = await asyncio.gather(*jobs, return_exceptions=True)
                statuses = [item for item in request.app.state.gateway.requests.values() if item.experiment_id == experiment_id][-payload.requests_per_phase:]
                latencies = [item.total_latency_ms for item in statuses if item.status == "completed"]
                item = {
                    "observation_id": str(uuid4()), "run_id": run_id, "experiment_id": experiment_id,
                    "policy": policy, "phase": phase, "phase_order": order,
                    "phase_started_at": phase_started, "phase_completed_at": datetime.now(UTC).isoformat(),
                    "request_count": payload.requests_per_phase,
                    "completed": sum(not isinstance(result, Exception) for result in results),
                    "failed": sum(isinstance(result, Exception) for result in results), "cancelled": 0,
                    "average_latency_ms": sum(latencies) / len(latencies) if latencies else None,
                    "latency_samples_ms": latencies, "queue_depth_at_start": queue_before,
                    "active_requests_at_end": len(request.app.state.gateway.scheduler.active),
                    "worker_count": len(request.app.state.backend_pool.entries) if request.app.state.backend_pool else 1,
                    "fault_delay_ms": delay, "duration_ms": (time.monotonic() - started) * 1000,
                }
                request.app.state.repository.save_fault_observation(item)
                observations.append(item)
    finally:
        await set_fault(request, 0)
    return {"run_id": run_id, "observations": observations}
