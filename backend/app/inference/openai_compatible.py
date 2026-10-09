"""Adapter for vLLM and other OpenAI-compatible `/v1` inference servers."""

from collections.abc import AsyncIterator
import json
from typing import Any

import httpx

from app.core.config import Settings
from app.models.requests import InferenceRequest, InferenceResponse


class RealInferenceError(RuntimeError):
    """Safe error from a configured real provider; never triggers a mock fallback."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class OpenAICompatibleAdapter:
    """Minimal non-streaming chat-completions adapter for a configured real server."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not settings.llm_base_url or not settings.llm_model_id:
            raise ValueError("LLM_BASE_URL and LLM_MODEL_ID are required for a real adapter")
        self._base_url = settings.llm_base_url.rstrip("/")
        self.model_id = settings.llm_model_id
        self.verify_model_id = settings.llm_verify_model_id
        self._transport = transport
        self._timeout = httpx.Timeout(
            timeout=settings.request_timeout_seconds,
            connect=settings.llm_connect_timeout_seconds,
        )
        self._headers = {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self._timeout, headers=self._headers, transport=self._transport)

    @staticmethod
    def _error(response: httpx.Response, operation: str) -> RealInferenceError:
        if response.status_code in {401, 403}:
            return RealInferenceError(f"real provider authentication failed during {operation}", response.status_code)
        if response.status_code == 404:
            return RealInferenceError(f"configured model or provider endpoint was not found during {operation}", 404)
        if response.status_code == 429:
            return RealInferenceError("real provider rate limit exceeded", 429)
        return RealInferenceError(f"real provider returned HTTP {response.status_code} during {operation}")

    async def list_models(self) -> list[dict[str, Any]]:
        try:
            async with self._client() as client:
                response = await client.get(f"{self._base_url}/models")
        except httpx.TimeoutException as exc:
            raise RealInferenceError("real provider timed out while discovering models", 504) from exc
        except httpx.HTTPError as exc:
            raise RealInferenceError("real provider is unavailable while discovering models") from exc
        if response.is_error:
            raise self._error(response, "model discovery")
        try:
            data = response.json().get("data", [])
            return [{"id": item["id"], "object": item.get("object", "model")} for item in data]
        except (AttributeError, KeyError, ValueError, TypeError) as exc:
            raise RealInferenceError("real provider returned an invalid models response") from exc

    async def health_check(self) -> dict[str, Any]:
        models = await self.list_models()
        model_ids = {model["id"] for model in models}
        if self.verify_model_id and self.model_id not in model_ids:
            raise RealInferenceError(f"configured model '{self.model_id}' is not available from the real provider", 503)
        return {
            "status": "ok",
            "provider": "openai_compatible",
            "configured_model": self.model_id,
            "model_verified": self.model_id in model_ids,
        }

    async def generate(self, request: InferenceRequest, request_id: str) -> InferenceResponse:
        if request.model != self.model_id:
            raise RealInferenceError(f"model '{request.model}' is not configured for the real provider", 404)
        if request.prompt is not None:
            raise RealInferenceError("text prompt completion is not available in Phase 2; use messages", 422)
        payload = {
            "model": self.model_id,
            "messages": [message.model_dump() for message in request.messages or []],
            "max_tokens": request.max_output_tokens,
            "temperature": request.temperature,
            "stream": False,
        }
        try:
            async with self._client() as client:
                response = await client.post(f"{self._base_url}/chat/completions", json=payload)
        except httpx.TimeoutException as exc:
            raise RealInferenceError("real inference request timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise RealInferenceError("real provider is unavailable for inference") from exc
        if response.is_error:
            raise self._error(response, "chat completion")
        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise TypeError("message content is not text")
            usage = data.get("usage") or {}
            return InferenceResponse(
                request_id=request_id,
                model=data.get("model", self.model_id),
                output=content,
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
                input_token_method="provider_reported" if "prompt_tokens" in usage else "unavailable",
                output_token_method="provider_reported" if "completion_tokens" in usage else "unavailable",
                simulated=False,
            )
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RealInferenceError("real provider returned an invalid chat completion response") from exc

    async def generate_stream(self, request: InferenceRequest) -> AsyncIterator[dict[str, Any]]:
        if request.model != self.model_id or request.prompt is not None:
            raise RealInferenceError("real streaming requires the configured model and chat messages", 422)
        payload = {"model": self.model_id, "messages": [m.model_dump() for m in request.messages or []], "max_tokens": request.max_output_tokens, "temperature": request.temperature, "stream": True}
        try:
            async with self._client() as client:
                async with client.stream("POST", f"{self._base_url}/chat/completions", json=payload) as response:
                    if response.is_error:
                        raise self._error(response, "streaming chat completion")
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[6:]
                        if raw == "[DONE]":
                            break
                        data = json.loads(raw)
                        choice = (data.get("choices") or [{}])[0]
                        content = (choice.get("delta") or {}).get("content")
                        if content:
                            yield {"type": "token", "content": content}
                        if data.get("usage"):
                            yield {"type": "usage", **data["usage"], "simulated": False}
        except httpx.TimeoutException as exc:
            raise RealInferenceError("real streaming request timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise RealInferenceError("real provider is unavailable for streaming") from exc
