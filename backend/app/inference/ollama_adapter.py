"""Optional local Ollama adapter, isolated from scheduling policy."""

import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.core.config import Settings
from app.inference.openai_compatible import RealInferenceError
from app.models.requests import InferenceRequest, InferenceResponse


class OllamaAdapter:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None, *, model_id: str | None = None, component: str = "backend") -> None:
        base_url = settings.ollama_base_url or settings.llm_base_url
        configured_model = model_id or settings.backend_ollama_model
        if not base_url or not configured_model:
            raise ValueError(f"Ollama base URL and {component} model are required")
        self.base_url = base_url.rstrip("/").removesuffix("/v1")
        self.model_id = configured_model
        self.component = component
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
        matched = (
            self.model_id in ids
            or f"{self.model_id}:latest" in ids
            or any(item.split(":")[0] == self.model_id for item in ids)
        )
        if not matched:
            raise RealInferenceError(
                f"Ollama model '{self.model_id}' required by {self.component} is unavailable; run: ollama pull {self.model_id}", 503
            )
        return {"status": "ok", "provider": "ollama", "configured_model": self.model_id, "model_verified": True}

    async def generate(self, request: InferenceRequest, request_id: str) -> InferenceResponse:
        if request.model != self.model_id:
            raise RealInferenceError(f"model '{request.model}' is not configured on this gateway", 404)
        messages = [m.model_dump() for m in request.messages or []]
        if request.prompt is not None:
            messages = [{"role": "user", "content": request.prompt}]

        think = bool((request.metadata or {}).get("think", False))
        payload: dict[str, Any] = {
            "model": self.model_id,
            "messages": messages,
            "stream": True,
            "think": think,
            "options": {
                "temperature": request.temperature,
                "num_predict": request.max_output_tokens,
            },
        }

        try:
            started = time.monotonic()
            first_token_at = None
            output: list[str] = []
            thinking: list[str] = []
            final: dict[str, Any] = {}
            async with self.client() as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        data = json.loads(line)
                        msg = data.get("message") or {}
                        content = msg.get("content")
                        think_text = msg.get("thinking")
                        if think_text:
                            thinking.append(think_text)
                            if first_token_at is None:
                                first_token_at = time.monotonic()
                        if content:
                            if first_token_at is None:
                                first_token_at = time.monotonic()
                            output.append(content)
                        if data.get("done"):
                            final = data

            result_text = "".join(output)
            if not result_text and thinking:
                result_text = "".join(thinking)

            result = InferenceResponse(
                request_id=request_id,
                model=final.get("model", self.model_id),
                output=result_text,
                input_tokens=final.get("prompt_eval_count", 0),
                output_tokens=final.get("eval_count", 0),
                input_token_method="provider_reported" if "prompt_eval_count" in final else "unavailable",
                output_token_method="provider_reported" if "eval_count" in final else "unavailable",
                simulated=False,
                ttft_ms=((first_token_at or time.monotonic()) - started) * 1000,
            )
            logging.getLogger("gateway.inference").info(
                "request_id=%s component=%s model=%s duration_ms=%.2f success=true",
                request_id, self.component, self.model_id, (time.monotonic() - started) * 1000,
            )
            return result
        except httpx.TimeoutException as exc:
            logging.getLogger("gateway.inference").warning("request_id=%s component=%s model=%s success=false error=timeout", request_id, self.component, self.model_id)
            raise RealInferenceError(f"Ollama inference timed out for {self.component} model '{self.model_id}'", 504) from exc
        except httpx.HTTPStatusError as exc:
            logging.getLogger("gateway.inference").warning("request_id=%s component=%s model=%s success=false error=http_%s", request_id, self.component, self.model_id, exc.response.status_code)
            raise RealInferenceError(f"Ollama returned HTTP {exc.response.status_code}: {exc.response.text}", exc.response.status_code) from exc
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            logging.getLogger("gateway.inference").warning("request_id=%s component=%s model=%s success=false error=request_failed", request_id, self.component, self.model_id)
            raise RealInferenceError(f"Ollama inference failed for {self.component} model '{self.model_id}'") from exc

    async def generate_stream(self, request: InferenceRequest) -> AsyncIterator[dict[str, Any]]:
        if request.model != self.model_id:
            raise RealInferenceError(f"model '{request.model}' is not configured on this gateway", 404)
        messages = [m.model_dump() for m in request.messages or []]
        if request.prompt is not None:
            messages = [{"role": "user", "content": request.prompt}]

        think = bool((request.metadata or {}).get("think", False))
        payload: dict[str, Any] = {
            "model": self.model_id,
            "messages": messages,
            "stream": True,
            "think": think,
            "options": {
                "temperature": request.temperature,
                "num_predict": request.max_output_tokens,
            },
        }

        try:
            async with self.client() as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        data = json.loads(line)
                        msg = data.get("message") or {}
                        content = msg.get("content")
                        think_text = msg.get("thinking")
                        if think_text and not content:
                            yield {"type": "token", "content": think_text}
                        elif content:
                            yield {"type": "token", "content": content}
                        if data.get("done"):
                            yield {"type": "usage", "input_tokens": data.get("prompt_eval_count", 0), "output_tokens": data.get("eval_count", 0), "simulated": False}
        except (httpx.HTTPError, ValueError) as exc:
            raise RealInferenceError("Ollama streaming request failed") from exc
