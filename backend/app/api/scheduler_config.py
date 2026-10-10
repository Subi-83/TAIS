from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/scheduler/config", tags=["scheduler"])


class SchedulerConfig(BaseModel):
    policy: str = Field(pattern="^(fifo|token_aware)$")
    max_wait_seconds: float = Field(gt=0, le=3600)
    max_queue: int = Field(gt=0, le=100_000)
    aging_weight: float = Field(default=1.0, ge=0, le=10_000)


@router.get("")
async def get_config(request: Request) -> dict:
    engine = request.app.state.gateway.scheduler
    return {"policy": engine.policy, "max_wait_seconds": engine.max_wait_seconds, "max_queue": engine.max_queue, "aging_weight": engine.aging_weight}


@router.put("")
async def set_config(payload: SchedulerConfig, request: Request) -> dict:
    engine = request.app.state.gateway.scheduler
    if engine.active:
        raise HTTPException(status_code=409, detail="cannot alter scheduler configuration while a request is active")
    engine.policy = payload.policy
    engine.max_wait_seconds = payload.max_wait_seconds
    engine.max_queue = payload.max_queue
    engine.aging_weight = payload.aging_weight
    return await get_config(request)
