from fastapi import APIRouter, HTTPException, Request

from app.inference.mock_adapter import MockBackendError
from app.inference.openai_compatible import RealInferenceError

router = APIRouter(prefix="/api/backends", tags=["backends"])


def backend(request: Request) -> dict:
    settings = request.app.state.settings
    is_real = settings.inference_mode == "real"
    return {
        "backend_id": "real-provider-1" if is_real else "mock-backend-1",
        "provider": settings.llm_provider if is_real else "mock",
        "base_url": settings.llm_base_url if is_real else settings.mock_backend_url,
        "served_models": [settings.llm_model_id] if is_real else ["mock-echo-1"],
        "active_requests": 1 if request.app.state.gateway.scheduler.active else 0,
        "queue_depth": len(request.app.state.gateway.scheduler.pending),
    }


@router.get("")
async def list_backends(request: Request) -> dict:
    return {"data": [backend(request)]}


@router.get("/{backend_id}")
async def get_backend(backend_id: str, request: Request) -> dict:
    item = backend(request)
    if backend_id != item["backend_id"]:
        raise HTTPException(status_code=404, detail="backend not found")
    return item


@router.get("/{backend_id}/health")
async def backend_health(backend_id: str, request: Request) -> dict:
    item = await get_backend(backend_id, request)
    try:
        detail = await (request.app.state.real_adapter.health_check() if request.app.state.settings.inference_mode == "real" else request.app.state.mock_adapter.health_check())
    except (MockBackendError, RealInferenceError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {**item, "health": detail}
