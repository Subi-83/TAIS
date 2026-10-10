import json
from pathlib import Path
import pytest
import httpx

from app.tokenization.token_predictor import TokenPredictor, PredictionResult
from app.experiments.llm_planner import ExcelWorkloadPlanner
from app.models.requests import InferenceRequest


WORKBOOK = Path(__file__).parents[1] / "backend" / "data" / "D07_150_Questions_Token_Predictor.xlsx"


@pytest.mark.asyncio
async def test_token_predictor_successful_llm_response():
    async def handler(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        assert data["model"] == "qwen3:4b-q4_K_M"
        assert "Predicted output tokens:" in data["prompt"]
        return httpx.Response(200, json={"response": " 75 "})

    transport = httpx.MockTransport(handler)
    predictor = TokenPredictor(
        base_url="http://mock-ollama:11434",
        model="qwen3:4b-q4_K_M",
        transport=transport,
    )

    result = await predictor.predict("Explain quantum computing in detail")
    assert result.predicted_tokens == 75
    assert result.source == "qwen3:4b-q4_K_M"
    assert result.model == "qwen3:4b-q4_K_M"
    assert result.latency_ms >= 0


@pytest.mark.asyncio
async def test_token_predictor_caches_results():
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"response": "120"})

    transport = httpx.MockTransport(handler)
    predictor = TokenPredictor(transport=transport)

    res1 = await predictor.predict("What is photosynthesis?")
    assert res1.predicted_tokens == 120
    assert res1.source == "qwen3:4b-q4_K_M"
    assert calls == 1

    res2 = await predictor.predict("What is photosynthesis?")
    assert res2.predicted_tokens == 120
    assert res2.source == "qwen3:4b-q4_K_M:cache"
    assert calls == 1  # No second HTTP call


@pytest.mark.asyncio
async def test_token_predictor_handles_empty_query():
    predictor = TokenPredictor()
    result = await predictor.predict("   ", default_tokens=40)
    assert result.predicted_tokens == 40
    assert result.source == "default"


@pytest.mark.asyncio
async def test_token_predictor_disabled_uses_heuristic():
    predictor = TokenPredictor(enabled=False)
    result = await predictor.predict("What is the capital of France?")
    assert result.predicted_tokens == 30
    assert result.source == "deterministic_heuristic"


@pytest.mark.asyncio
async def test_token_predictor_error_falls_back_to_heuristic():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "Ollama out of memory"})

    transport = httpx.MockTransport(handler)
    predictor = TokenPredictor(transport=transport)

    result = await predictor.predict("What is the capital of France?")
    assert result.predicted_tokens == 30
    assert result.source == "deterministic_heuristic"


@pytest.mark.asyncio
async def test_token_predictor_non_integer_text_falls_back():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"response": "no numbers here"})

    transport = httpx.MockTransport(handler)
    predictor = TokenPredictor(transport=transport)

    result = await predictor.predict("What is the capital of France?")
    assert result.predicted_tokens == 30
    assert result.source == "deterministic_heuristic"


@pytest.mark.asyncio
async def test_excel_planner_uses_token_predictor_when_provided():
    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        prompt = body["prompt"]
        if "France" in prompt:
            return httpx.Response(200, json={"response": "5"})
        if "multiplied" in prompt:
            return httpx.Response(200, json={"response": "50"})
        return httpx.Response(200, json={"response": "25"})

    transport = httpx.MockTransport(handler)
    predictor = TokenPredictor(model="qwen3:4b-q4_K_M", transport=transport)
    planner = ExcelWorkloadPlanner(str(WORKBOOK), token_predictor=predictor)

    requests = await planner.generate("short_interactive", 2, "gemma4:12b")
    assert len(requests) == 2
    assert requests[0].expected_output_tokens == 5
    assert requests[0].metadata["output_prediction_source"] == "qwen3:4b-q4_K_M"
    assert requests[1].expected_output_tokens == 50
    assert requests[1].metadata["output_prediction_source"] == "qwen3:4b-q4_K_M"


@pytest.mark.asyncio
async def test_gateway_predicts_tokens_via_token_predictor_when_none_provided():
    from app.main import app
    from app.inference.mock_adapter import MockInferenceAdapter
    from app.core.config import Settings
    from mock_backend.main import app as mock_app

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"response": "88"})

    transport = httpx.MockTransport(handler)
    predictor = TokenPredictor(model="qwen3:4b-q4_K_M", transport=transport)

    async with app.router.lifespan_context(app):
        app.state.token_predictor = predictor
        app.state.mock_adapter = MockInferenceAdapter(
            Settings(mock_backend_url="http://mock"), transport=httpx.ASGITransport(app=mock_app)
        )
        asgi_transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=asgi_transport, base_url="http://gateway") as client:
            resp = await client.post(
                "/api/requests",
                json={"model": "mock-echo-1", "prompt": "Predict my tokens please"},
            )
        assert resp.status_code == 200
        req_id = resp.json()["request_id"]
        status = app.state.gateway.requests[req_id]
        assert status.estimated_output_tokens == 88
        assert status.output_prediction_source == "qwen3:4b-q4_K_M"

