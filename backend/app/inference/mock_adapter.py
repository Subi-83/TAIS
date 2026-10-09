from typing import Any
from collections.abc import AsyncIterator

import httpx

from app.core.config import Settings
from app.models.requests import InferenceRequest, InferenceResponse


class MockBackendError(RuntimeError):
    """A safe, gateway-owned representation of an upstream mock-backend error."""


class MockInferenceAdapter:
    """HTTP client for the Phase 1 mock inference process.

    This is intentionally separate from future real-provider adapters: gateway code
    forwards only normalized request data and never loads a model itself.
    """

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._base_url = settings.mock_backend_url.rstrip("/")
        self._timeout = httpx.Timeout(settings.request_timeout_seconds)
        self._transport = transport

    async def health_check(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(f"{self._base_url}/health")
                response.raise_for_status()
                data = response.json()
                if data.get("status") != "ok":
                    raise MockBackendError("mock backend is unhealthy")
                return data
        except (httpx.HTTPError, ValueError) as exc:
            raise MockBackendError("mock backend is unavailable") from exc

    async def generate(self, request: InferenceRequest, request_id: str) -> InferenceResponse:
        payload = request.model_dump()
        payload["request_id"] = request_id
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.post(f"{self._base_url}/v1/generate", json=payload)
                response.raise_for_status()
                data = response.json()
            return InferenceResponse(**data, input_token_method="mock_estimate", output_token_method="mock_estimate")
        except (httpx.HTTPError, ValueError) as exc:
            raise MockBackendError("mock inference request failed") from exc

    async def generate_stream(self, request: InferenceRequest, request_id: str) -> AsyncIterator[dict[str, Any]]:
        """Mock-only chunks are simulated words, never represented as model tokens."""
        response = await self.generate(request, request_id)
        for chunk in response.output.split(" "):
            yield {"type": "token", "content": f"{chunk} "}
        yield {"type": "usage", "input_tokens": response.input_tokens, "output_tokens": response.output_tokens, "simulated": True}
