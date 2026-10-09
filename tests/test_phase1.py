import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.core.config import Settings
from app.inference.mock_adapter import MockInferenceAdapter
from mock_backend.main import app as mock_app


@pytest.mark.asyncio
async def test_mock_backend_generates_deterministic_response():
    transport = ASGITransport(app=mock_app)
    async with AsyncClient(transport=transport, base_url="http://mock") as client:
        response = await client.post(
            "/v1/generate",
            json={"request_id": "r1", "model": "mock-echo-1", "prompt": "hello scheduler", "max_output_tokens": 20},
        )
    assert response.status_code == 200
    assert response.json()["output"] == "[mock:mock-echo-1] hello scheduler"


@pytest.mark.asyncio
async def test_gateway_rejects_ambiguous_input():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://gateway") as client:
        response = await client.post("/api/requests", json={"prompt": "x", "messages": [{"role": "user", "content": "y"}]})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_gateway_returns_client_correlation_id():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://gateway") as client:
            response = await client.get("/api/system/status", headers={"X-Request-ID": "ui-test-123"})
    assert response.headers["x-request-id"] == "ui-test-123"


@pytest.mark.asyncio
async def test_gateway_rejects_malformed_content_length_safely():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://gateway") as client:
        response = await client.get("/health", headers={"Content-Length": "not-a-number"})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_gateway_forwards_a_valid_inference_request_to_mock_backend():
    async with app.router.lifespan_context(app):
        app.state.mock_adapter = MockInferenceAdapter(
            Settings(mock_backend_url="http://mock"), transport=ASGITransport(app=mock_app)
        )
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://gateway") as client:
            response = await client.post(
                "/api/requests",
                json={"model": "mock-echo-1", "messages": [{"role": "user", "content": "Explain queues."}]},
            )
    assert response.status_code == 200
    assert response.json()["output"] == "[mock:mock-echo-1] Explain queues."
    assert response.json()["simulated"] is True
