import os

import httpx
from fastapi import FastAPI, Request
from starlette.responses import Response, StreamingResponse


app = FastAPI(title="Ollama Inference Worker")
upstream = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434").rstrip("/")
worker_id = os.getenv("WORKER_ID", "ollama-worker")
timeout = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "120"))


@app.get("/worker/health")
async def worker_health() -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{upstream}/api/tags")
        response.raise_for_status()
    return {"status": "ok", "worker_id": worker_id, "ollama": upstream}


@app.api_route("/api/{path:path}", methods=["GET", "POST"])
async def proxy_ollama(path: str, request: Request) -> Response:
    body = await request.body()
    headers = {"content-type": request.headers.get("content-type", "application/json")}

    async def stream_upstream():
        async with httpx.AsyncClient(timeout=None if path == "chat" else timeout) as client:
            async with client.stream(request.method, f"{upstream}/api/{path}", content=body, headers=headers) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk

    return StreamingResponse(stream_upstream(), media_type="application/x-ndjson")
