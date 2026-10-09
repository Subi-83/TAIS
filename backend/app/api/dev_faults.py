import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/dev/backends", tags=["development"])


class FaultConfig(BaseModel):
    latency_ms: int | None = Field(default=None, ge=0, le=60_000)
    failure_rate: float | None = Field(default=None, ge=0, le=1)
    unhealthy: bool | None = None


@router.post("/{backend_id}/faults")
async def faults(backend_id: str, payload: FaultConfig, request: Request) -> dict:
    settings = request.app.state.settings
    if not settings.enable_dev_fault_injection or settings.inference_mode != "mock" or backend_id != "mock-backend-1":
        raise HTTPException(status_code=404, detail="development fault injection is unavailable")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.put(f"{settings.mock_backend_url.rstrip('/')}/dev/faults", json=payload.model_dump(exclude_none=True))
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="mock backend fault configuration failed") from exc
