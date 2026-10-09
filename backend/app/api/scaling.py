from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/scaling", tags=["scaling"])


class ScalingConfig(BaseModel):
    min_replicas: int = Field(ge=0, le=100)
    max_replicas: int = Field(ge=1, le=100)
    dry_run: bool = True


@router.get("/status")
async def status(request: Request) -> dict:
    engine = request.app.state.gateway.scheduler
    return request.app.state.scaling.evaluate(len(engine.pending), 1 if engine.active else 0)


@router.get("/config")
async def config(request: Request) -> dict:
    return request.app.state.scaling.snapshot()


@router.put("/config")
async def configure(payload: ScalingConfig, request: Request) -> dict:
    try:
        return request.app.state.scaling.configure(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
