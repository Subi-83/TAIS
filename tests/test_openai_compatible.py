import json

import httpx
import pytest

from app.core.config import Settings
from app.inference.openai_compatible import OpenAICompatibleAdapter, RealInferenceError
from app.models.requests import InferenceRequest, Message


def adapter_for(handler):
    settings = Settings(
        inference_mode="real",
        llm_base_url="http://llm.test/v1",
        llm_model_id="served-model",
        llm_api_key="test-key",
    )
    return OpenAICompatibleAdapter(settings, transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_discovers_models_and_forwards_chat_completion_in_openai_format():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "served-model", "object": "model"}]})
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-key"
        assert json.loads(request.content) == {
            "model": "served-model",
            "messages": [{"role": "user", "content": "Hello"}],
            "max_tokens": 12,
            "temperature": 0.2,
            "stream": False,
        }
        return httpx.Response(
            200,
            json={
                "model": "served-model",
                "choices": [{"message": {"content": "Hi there"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2},
            },
        )

    adapter = adapter_for(handler)
    health = await adapter.health_check()
    result = await adapter.generate(
        InferenceRequest(model="served-model", messages=[Message(role="user", content="Hello")], max_output_tokens=12, temperature=0.2),
        "request-1",
    )
    assert health["model_verified"] is True
    assert result.output == "Hi there"
    assert result.input_tokens == 3
    assert result.output_tokens == 2
    assert result.simulated is False
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_real_adapter_never_substitutes_mock_on_auth_failure():
    adapter = adapter_for(lambda request: httpx.Response(401, json={"error": {"message": "bad key"}}))
    with pytest.raises(RealInferenceError, match="authentication failed") as error:
        await adapter.list_models()
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_real_adapter_rejects_unknown_requested_model_before_calling_provider():
    adapter = adapter_for(lambda request: pytest.fail("provider should not be called"))
    with pytest.raises(RealInferenceError, match="not configured") as error:
        await adapter.generate(InferenceRequest(model="other", messages=[Message(role="user", content="Hello")]), "request-2")
    assert error.value.status_code == 404


def test_real_mode_requires_endpoint_and_model_configuration():
    with pytest.raises(ValueError, match="LLM_BASE_URL"):
        Settings(inference_mode="real")
