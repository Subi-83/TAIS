import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.models.requests import InferenceRequest
from app.experiments.workload_generator import PROFILES, generate

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


class ExperimentCreate(BaseModel):
    name: str = Field(default="experiment", min_length=1, max_length=120)
    scheduler_policy: str = Field(default="fifo", pattern="^(fifo|token_aware)$")
    requests: list[InferenceRequest] = Field(default_factory=list, max_length=500)
    workload_profile: str | None = None
    request_count: int = Field(default=20, ge=1, le=50_000)
    model: str = "mock-echo-1"
    random_seed: int = 42


def registry(request: Request) -> dict:
    return request.app.state.experiments


def public(experiment: dict) -> dict:
    return {key: value for key, value in experiment.items() if not key.startswith("_")}


@router.post("")
async def create_experiment(payload: ExperimentCreate, request: Request) -> dict:
    if payload.workload_profile:
        if payload.requests:
            raise HTTPException(status_code=422, detail="provide requests or workload_profile, not both")
        try:
            payload.requests = generate(payload.workload_profile, payload.request_count, payload.model, payload.random_seed)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    experiment_id = str(uuid4())
    result = {
        "experiment_id": experiment_id,
        "name": payload.name,
        "status": "created",
        "scheduler_policy": payload.scheduler_policy,
        "created_at": datetime.now(UTC).isoformat(),
        "request_count": len(payload.requests),
        "workload_profile": payload.workload_profile,
        "random_seed": payload.random_seed,
        "requests": [item.model_dump() for item in payload.requests],
    }
    registry(request)[experiment_id] = result
    request.app.state.repository.save_experiment(result)
    return public(result)


@router.get("/profiles")
async def workload_profiles() -> dict:
    return {"data": sorted(PROFILES)}


@router.get("")
async def list_experiments(request: Request) -> dict:
    return {"data": [public(item) for item in registry(request).values()]}


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str, request: Request) -> dict:
    result = registry(request).get(experiment_id)
    if not result:
        raise HTTPException(status_code=404, detail="experiment not found")
    return public(result)


@router.post("/{experiment_id}/start")
async def start_experiment(experiment_id: str, request: Request) -> dict:
    experiment = registry(request).get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="experiment not found")
    if experiment["status"] not in {"created", "failed"}:
        raise HTTPException(status_code=409, detail="experiment has already started")
    experiment["status"] = "running"
    request.app.state.repository.save_experiment(experiment)
    gateway = request.app.state.gateway
    await gateway.events.publish(experiment_id, "experiment_started", {"experiment_id": experiment_id})

    async def run() -> None:
        try:
            jobs = []
            for raw in experiment["requests"]:
                payload = InferenceRequest(**raw, experiment_id=experiment_id, scheduler_policy=experiment["scheduler_policy"])
                jobs.append(asyncio.create_task(gateway.submit(payload)))
            if jobs:
                await asyncio.gather(*jobs)
            experiment["status"] = "completed"
            request.app.state.repository.save_experiment(experiment)
            await gateway.events.publish(experiment_id, "experiment_completed", {"experiment_id": experiment_id})
        except Exception as exc:
            experiment["status"] = "failed"
            experiment["error"] = str(exc)
            request.app.state.repository.save_experiment(experiment)
            await gateway.events.publish(experiment_id, "experiment_failed", {"error": str(exc)})

    experiment["_task"] = asyncio.create_task(run())
    return public(experiment)


@router.post("/{experiment_id}/cancel")
async def cancel_experiment(experiment_id: str, request: Request) -> dict:
    experiment = registry(request).get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="experiment not found")
    task = experiment.get("_task")
    if task and not task.done():
        task.cancel()
    experiment["status"] = "cancelled"
    request.app.state.repository.save_experiment(experiment)
    return public(experiment)


@router.get("/{experiment_id}/events")
async def experiment_events(experiment_id: str, request: Request):
    if experiment_id not in registry(request):
        raise HTTPException(status_code=404, detail="experiment not found")
    last = request.headers.get("last-event-id")
    try:
        last_id = int(last) if last else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Last-Event-ID must be an integer")
    return StreamingResponse(request.app.state.gateway.events.subscribe(experiment_id, last_id), media_type="text/event-stream")


@router.get("/{experiment_id}/metrics")
async def experiment_metrics(experiment_id: str, request: Request) -> dict:
    if experiment_id not in registry(request):
        raise HTTPException(status_code=404, detail="experiment not found")
    return request.app.state.gateway.metrics.snapshot(experiment_id)


@router.get("/{experiment_id}/report")
async def experiment_report(experiment_id: str, request: Request) -> dict:
    experiment = registry(request).get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="experiment not found")
    return {"experiment": public(experiment), "metrics": request.app.state.gateway.metrics.snapshot(experiment_id), "measurement_type": "mock" if request.app.state.settings.inference_mode == "mock" else "real"}
