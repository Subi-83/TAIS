import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.inference.mock_adapter import MockInferenceAdapter
from app.main import app
from mock_backend.main import app as mock_app


@pytest.mark.asyncio
async def test_mock_stream_emits_lifecycle_and_incremental_content():
    async with app.router.lifespan_context(app):
        app.state.mock_adapter = MockInferenceAdapter(Settings(mock_backend_url="http://mock"), transport=ASGITransport(app=mock_app))
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://gateway") as client:
            response = await client.post("/api/requests/stream", json={"model": "mock-echo-1", "prompt": "stream this", "max_output_tokens": 20})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: request_started" in response.text
    assert "event: token" in response.text
    assert "event: request_completed" in response.text
