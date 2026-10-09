"""Optional local Ollama adapter, isolated from scheduling policy."""

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.core.config import Settings
from app.inference.openai_compatible import RealInferenceError
from app.models.requests import InferenceRequest, InferenceResponse


class OllamaAdapter:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not settings.llm_base_url or not settings.llm_model_id:
            raise ValueError("LLM_BASE_URL and LLM_MODEL_ID are required for Ollama")
        self.base_url = settings.llm_base_url.rstrip("/").removesuffix("/v1")
        self.model_id = settings.llm_model_id
        self.timeout = httpx.Timeout(settings.request_timeout_seconds, connect=settings.llm_connect_timeout_seconds)
        self.transport = transport

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout, transport=self.transport)

    async def list_models(self) -> list[dict[str, Any]]:
        try:
            async with self.client() as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                return [{"id": model["name"], "object": "model"} for model in response.json().get("models", [])]
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise RealInferenceError("Ollama model discovery failed") from exc

    async def health_check(self) -> dict:
        models = await self.list_models()
        ids = {item["id"] for item in models}
        if self.model_id not in ids:
            raise RealInferenceError(f"configured Ollama model '{self.model_id}' is unavailable", 503)
        return {"status": "ok", "provider": "ollama", "configured_model": self.model_id, "model_verified": True}

    async def generate(self, request: InferenceRequest, request_id: str) -> InferenceResponse:
        if request.model != self.model_id or request.prompt is not None:
            raise RealInferenceError("Ollama Phase 2 supports configured chat model messages only", 422)
        try:
            async with self.client() as client:
                response = await client.post(f"{self.base_url}/api/chat", json={"model": self.model_id, "messages": [m.model_dump() for m in request.messages or []], "stream": False, "options": {"temperature": request.temperature, "num_predict": request.max_output_tokens}})
            response.raise_for_status()
            data = response.json()
            return InferenceResponse(request_id=request_id, model=data.get("model", self.model_id), output=data["message"]["content"], input_tokens=data.get("prompt_eval_count", 0), output_tokens=data.get("eval_count", 0), input_token_method="provider_reported" if "prompt_eval_count" in data else "unavailable", output_token_method="provider_reported" if "eval_count" in data else "unavailable", simulated=False)
        except httpx.TimeoutException as exc:
            raise RealInferenceError("Ollama inference request timed out", 504) from exc
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            raise RealInferenceError("Ollama inference request failed") from exc

    async def generate_stream(self, request: InferenceRequest) -> AsyncIterator[dict[str, Any]]:
        if request.model != self.model_id or request.prompt is not None:
            raise RealInferenceError("Ollama streaming requires configured chat messages", 422)
        try:
            async with self.client() as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json={"model": self.model_id, "messages": [m.model_dump() for m in request.messages or []], "stream": True, "options": {"temperature": request.temperature, "num_predict": request.max_output_tokens}}) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        data = json.loads(line)
                        content = (data.get("message") or {}).get("content")
                        if content:
                            yield {"type": "token", "content": content}
                        if data.get("done"):
                            yield {"type": "usage", "input_tokens": data.get("prompt_eval_count", 0), "output_tokens": data.get("eval_count", 0), "simulated": False}
        except (httpx.HTTPError, ValueError) as exc:
            raise RealInferenceError("Ollama streaming request failed") from exc
