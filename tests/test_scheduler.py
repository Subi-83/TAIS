import asyncio
import time

import pytest

from app.models.requests import InferenceRequest, InferenceResponse
from app.scheduler.engine import QueuedRequest, SchedulerEngine


def queued(request_id: str, payload: InferenceRequest, created_at: float | None = None) -> QueuedRequest:
    return QueuedRequest(request_id, payload, created_at or time.monotonic(), 1, asyncio.get_running_loop().create_future())


@pytest.mark.asyncio
async def test_token_aware_policy_dispatches_shorter_estimated_work_first():
    seen = []

    async def execute(item):
        seen.append(item.request_id)
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    engine = SchedulerEngine(execute, policy="token_aware")
    long = queued("long", InferenceRequest(prompt="long", max_output_tokens=100))
    short = queued("short", InferenceRequest(prompt="short", max_output_tokens=1))
    engine.pending = [long, short]
    assert engine._next().request_id == "short"


@pytest.mark.asyncio
async def test_aging_promotes_old_request_over_short_new_request():
    async def execute(item):
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    engine = SchedulerEngine(execute, policy="token_aware", max_wait_seconds=1)
    old = queued("old", InferenceRequest(prompt="old", max_output_tokens=100), time.monotonic() - 2)
    new = queued("new", InferenceRequest(prompt="new", max_output_tokens=1))
    engine.pending = [new, old]
    assert engine._next().request_id == "old"
