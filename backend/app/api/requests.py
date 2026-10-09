import json

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.inference.mock_adapter import MockBackendError
from app.inference.openai_compatible import RealInferenceError
from app.models.requests import InferenceRequest, InferenceResponse, RequestStatus

router = APIRouter(prefix="/api/requests", tags=["inference"])


@router.post("", response_model=InferenceResponse, status_code=status.HTTP_200_OK)
async def create_request(payload: InferenceRequest, request: Request) -> InferenceResponse:
    try:
        return await request.app.state.gateway.submit(payload)
    except MockBackendError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RealInferenceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/stream")
async def stream_request(payload: InferenceRequest, request: Request):
    async def events():
        async for item in request.app.state.gateway.stream(payload):
            yield f"event: {item['type']}\ndata: {json.dumps(item)}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")


@router.get("/{request_id}", response_model=RequestStatus)
async def get_request(request_id: str, request: Request) -> RequestStatus:
    result = request.app.state.gateway.requests.get(request_id)
    if not result:
        raise HTTPException(status_code=404, detail="request not found")
    return result


@router.post("/{request_id}/cancel", response_model=RequestStatus)
async def cancel_request(request_id: str, request: Request) -> RequestStatus:
    current = request.app.state.gateway.requests.get(request_id)
    if not current:
        raise HTTPException(status_code=404, detail="request not found")
    if not request.app.state.gateway.cancel(request_id):
        raise HTTPException(status_code=409, detail="request cannot be cancelled after dispatch")
    current.status = "cancelled"
    return current
