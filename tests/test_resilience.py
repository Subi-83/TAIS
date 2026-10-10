import pytest

from app.backends.resilience import BackendResilienceAgent
from app.inference.openai_compatible import RealInferenceError


@pytest.mark.asyncio
async def test_agent_retries_transient_backend_failure_and_recovers():
    events = []
    attempts = 0
    agent = BackendResilienceAgent(2, 0, 3, 1)

    async def operation():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RealInferenceError("temporary outage", 503)
        return "ok"

    async def event(name, data):
        events.append(name)

    assert await agent.execute(operation, event) == "ok"
    assert attempts == 2
    assert events == ["backend_retry", "backend_recovered"]
    assert agent.snapshot()["state"] == "closed"


@pytest.mark.asyncio
async def test_agent_does_not_retry_client_validation_errors():
    agent = BackendResilienceAgent(2, 0, 3, 1)

    async def operation():
        raise RealInferenceError("bad request", 422)

    async def event(name, data):
        pytest.fail("no resilience event expected")

    with pytest.raises(RealInferenceError):
        await agent.execute(operation, event)
    assert agent.total_retries == 0
