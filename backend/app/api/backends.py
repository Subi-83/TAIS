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
        "base_url": (settings.ollama_base_url or settings.llm_base_url) if is_real else settings.mock_backend_url,
        "served_models": [settings.backend_ollama_model if settings.llm_provider == "ollama" else settings.llm_model_id] if is_real else ["mock-echo-1"],
        "status": "healthy" if request.app.state.health_monitor.healthy else "unhealthy",
        "active_requests": len(request.app.state.gateway.scheduler.active),
        "queue_depth": len(request.app.state.gateway.scheduler.pending),
        "fault_tolerance": request.app.state.resilience.snapshot(),
    }


@router.get("")
async def list_backends(request: Request) -> dict:
    if request.app.state.backend_pool:
        return {"data": request.app.state.backend_pool.snapshot()}
    return {"data": [backend(request)]}


@router.get("/{backend_id}")
async def get_backend(backend_id: str, request: Request) -> dict:
    if request.app.state.backend_pool:
        item = next((item for item in request.app.state.backend_pool.snapshot() if item["backend_id"] == backend_id), None)
        if not item:
            raise HTTPException(status_code=404, detail="backend not found")
        return item
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
