import json
import httpx
import pytest

from app.core.config import Settings
from app.inference.ollama_adapter import OllamaAdapter
from app.models.requests import InferenceRequest, Message


def adapter_for(handler):
    settings = Settings(
        inference_mode="real",
        llm_provider="ollama",
        ollama_base_url="http://127.0.0.1:11434",
        backend_ollama_model="gemma4:12b",
    )
    return OllamaAdapter(settings, transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_ollama_chat_disables_thinking_by_default_and_returns_content():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "gemma4:12b"}]})
        assert request.url.path == "/api/chat"
        body = json.loads(request.content)
        assert body["model"] == "gemma4:12b"
        assert body["think"] is False
        assert body["options"]["num_predict"] == 64
        lines = [
            json.dumps({"model": "gemma4:12b", "message": {"role": "assistant", "content": "Hello world"}, "done": False}),
            json.dumps({"model": "gemma4:12b", "message": {"role": "assistant", "content": ""}, "done": True, "prompt_eval_count": 5, "eval_count": 2}),
        ]
        return httpx.Response(200, content=("\n".join(lines) + "\n").encode())

    adapter = adapter_for(handler)
    health = await adapter.health_check()
    assert health["status"] == "ok"
    assert health["model_verified"] is True

    result = await adapter.generate(
        InferenceRequest(model="gemma4:12b", prompt="Hi", max_output_tokens=64),
        "req-1",
    )
    assert result.output == "Hello world"
    assert result.input_tokens == 5
    assert result.output_tokens == 2
    assert result.simulated is False


@pytest.mark.asyncio
async def test_ollama_falls_back_to_thinking_if_content_is_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        lines = [
            json.dumps({"model": "gemma4:12b", "message": {"role": "assistant", "content": "", "thinking": "Let me think about it."}, "done": False}),
            json.dumps({"model": "gemma4:12b", "message": {"role": "assistant", "content": ""}, "done": True, "prompt_eval_count": 10, "eval_count": 128}),
        ]
        return httpx.Response(200, content=("\n".join(lines) + "\n").encode())

    adapter = adapter_for(handler)
    result = await adapter.generate(
        InferenceRequest(model="gemma4:12b", prompt="Complex problem", max_output_tokens=128),
        "req-2",
    )
    assert result.output == "Let me think about it."
    assert result.output_tokens == 128


@pytest.mark.asyncio
async def test_ollama_streaming():
    def handler(request: httpx.Request) -> httpx.Response:
        lines = [
            json.dumps({"model": "gemma4:12b", "message": {"role": "assistant", "content": "chunk 1"}, "done": False}),
            json.dumps({"model": "gemma4:12b", "message": {"role": "assistant", "content": "chunk 2"}, "done": False}),
            json.dumps({"model": "gemma4:12b", "done": True, "prompt_eval_count": 4, "eval_count": 6}),
        ]
        return httpx.Response(200, content=("\n".join(lines) + "\n").encode())

    adapter = adapter_for(handler)
    tokens = []
    async for event in adapter.generate_stream(InferenceRequest(model="gemma4:12b", prompt="test")):
        if event["type"] == "token":
            tokens.append(event["content"])
        elif event["type"] == "usage":
            assert event["output_tokens"] == 6

    assert tokens == ["chunk 1", "chunk 2"]
