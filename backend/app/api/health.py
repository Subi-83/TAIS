from fastapi import APIRouter, HTTPException, Request

from app.inference.mock_adapter import MockBackendError
from app.inference.openai_compatible import RealInferenceError

router = APIRouter(tags=["system"])


@router.get("/health")
async def health(request: Request) -> dict:
    try:
        if request.app.state.settings.inference_mode == "mock":
            backend = await request.app.state.mock_adapter.health_check()
        else:
            backend = await request.app.state.real_adapter.health_check()
    except (MockBackendError, RealInferenceError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ok", "mode": request.app.state.settings.inference_mode, "backend": backend}
