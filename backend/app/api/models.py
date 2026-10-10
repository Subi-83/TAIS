from fastapi import APIRouter, HTTPException, Request

from app.inference.openai_compatible import RealInferenceError

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("")
async def list_models(request: Request) -> dict:
    settings = request.app.state.settings
    if settings.inference_mode == "mock":
        return {"data": [{"id": "mock-echo-1", "provider": "mock", "available": True}]}
    if request.app.state.backend_pool:
        return {"data": [
            {"id": item["served_models"][0], "provider": item["provider"], "backend_id": item["backend_id"], "available": item["status"] == "healthy"}
            for item in request.app.state.backend_pool.snapshot()
        ]}
    try:
        return {"data": await request.app.state.real_adapter.list_models()}
    except RealInferenceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/{model_id}")
async def get_model(model_id: str, request: Request) -> dict:
    result = await list_models(request)
    for model in result["data"]:
        if model["id"] == model_id:
            return model
    raise HTTPException(status_code=404, detail=f"model '{model_id}' was not found")


@router.get("/{model_id}/health")
async def model_health(model_id: str, request: Request) -> dict:
    model = await get_model(model_id, request)
    if request.app.state.backend_pool:
        backend = next(item for item in request.app.state.backend_pool.entries if item.backend_id == model["backend_id"])
        try:
            detail = await backend.adapter.health_check()
            return {"model": model, "healthy": True, "provider": backend.provider, "detail": detail}
        except RealInferenceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    settings = request.app.state.settings
    try:
        health = await (request.app.state.real_adapter.health_check() if settings.inference_mode == "real" else request.app.state.mock_adapter.health_check())
    except RealInferenceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"model": model, "healthy": health.get("status") == "ok", "provider": health.get("provider", "mock"), "detail": health}
