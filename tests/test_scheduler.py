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


@pytest.mark.asyncio
async def test_score_is_estimated_cost_minus_aging_weight_times_wait():
    async def execute(item):
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    now = time.monotonic()
    engine = SchedulerEngine(execute, policy="token_aware", max_wait_seconds=1000, aging_weight=10)
    old = queued("old", InferenceRequest(prompt="old", max_output_tokens=100), now - 10)
    new = queued("new", InferenceRequest(prompt="new", max_output_tokens=1), now)
    engine.pending = [new, old]
    assert engine._next().request_id == "old"


@pytest.mark.asyncio
async def test_fifo_dispatches_in_arrival_order():
    async def execute(item):
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    now = time.monotonic()
    engine = SchedulerEngine(execute, policy="fifo")
    engine.pending = [
        queued("second", InferenceRequest(prompt="second"), now + 1),
        queued("first", InferenceRequest(prompt="first"), now),
    ]

    assert engine._next().request_id == "first"


@pytest.mark.asyncio
async def test_output_token_weight_is_applied_to_estimated_cost():
    item = queued("weighted", InferenceRequest(prompt="x", expected_output_tokens=100))
    item.input_tokens = 20
    item.output_token_weight = 1.5

    assert item.estimated_tokens == 170


@pytest.mark.asyncio
async def test_multiple_overdue_requests_are_dispatched_fifo():
    async def execute(item):
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    now = time.monotonic()
    engine = SchedulerEngine(execute, policy="token_aware", max_wait_seconds=0.05)
    first = queued("first-overdue", InferenceRequest(prompt="expensive", max_output_tokens=1000), now - 1)
    second = queued("second-overdue", InferenceRequest(prompt="expensive", max_output_tokens=900), now - 0.5)
    cheap = queued("cheap", InferenceRequest(prompt="cheap", max_output_tokens=1), now)
    engine.pending = [cheap, second, first]

    assert engine._next().request_id == "first-overdue"
    assert engine._next().request_id == "second-overdue"
    assert engine.overdue_dispatched == 2


@pytest.mark.asyncio
async def test_maximum_bypass_promotes_an_expensive_request():
    async def execute(item):
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    engine = SchedulerEngine(execute, policy="token_aware", max_wait_seconds=1000, max_bypass=2)
    expensive = queued("expensive", InferenceRequest(prompt="long", max_output_tokens=1000))
    expensive.bypassed = 2
    engine.pending = [queued("cheap", InferenceRequest(prompt="short", max_output_tokens=1)), expensive]

    selected = engine._next()
    assert selected.request_id == "expensive"
    assert selected.selection_reason == "maximum_bypass"


@pytest.mark.asyncio
async def test_continuous_cheap_arrivals_cannot_bypass_overdue_expensive_request():
    async def execute(item):
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    engine = SchedulerEngine(execute, policy="token_aware", max_wait_seconds=0.01)
    expensive = queued("expensive", InferenceRequest(prompt="long", max_output_tokens=1000), time.monotonic() - 1)
    engine.pending = [expensive] + [queued(f"cheap-{index}", InferenceRequest(prompt="short", max_output_tokens=1)) for index in range(100)]

    selected = engine._next()
    assert selected.request_id == "expensive"
    assert selected.overdue_at_dispatch is True


@pytest.mark.asyncio
async def test_adversarial_stream_dispatches_long_request_after_measured_max_wait():
    dispatched = []
    waits = {}

    async def execute(item):
        waits[item.request_id] = time.monotonic() - item.created_at
        dispatched.append(item.request_id)
        if item.request_id == "blocker":
            await asyncio.sleep(0.08)
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    engine = SchedulerEngine(execute, policy="token_aware", max_wait_seconds=0.05, capacity=lambda queued, active: 1)
    engine.start()
    try:
        blocker = queued("blocker", InferenceRequest(prompt="blocker", max_output_tokens=1))
        blocker_task = asyncio.create_task(engine.submit(blocker))
        await asyncio.sleep(0.005)
        expensive = queued("expensive", InferenceRequest(prompt="long", max_output_tokens=1000))
        expensive_task = asyncio.create_task(engine.submit(expensive))
        # Exceed coarse Windows monotonic-clock resolution so enqueue order is
        # observable independently of the request-id tie breaker.
        await asyncio.sleep(0.02)
        cheap_tasks = []
        for index in range(15):
            cheap_tasks.append(asyncio.create_task(engine.submit(queued(f"cheap-{index}", InferenceRequest(prompt="short", max_output_tokens=1)))))
            await asyncio.sleep(0.003)
        await asyncio.gather(blocker_task, expensive_task, *cheap_tasks)
    finally:
        await engine.close()

    assert dispatched[:2] == ["blocker", "expensive"], (dispatched, waits)
    assert waits["expensive"] >= 0.05
    assert engine.overdue_dispatched >= 1


@pytest.mark.asyncio
async def test_zero_capacity_waits_for_cold_worker_without_failing_request():
    dispatched = []
    available = 0

    async def execute(item):
        dispatched.append(item.request_id)
        return InferenceResponse(request_id=item.request_id, model="mock-echo-1", output="ok", input_tokens=1, output_tokens=1)

    engine = SchedulerEngine(execute, capacity=lambda queued, active: available)
    engine.start()
    try:
        task = asyncio.create_task(engine.submit(queued("cold", InferenceRequest(prompt="cold start"))))
        await asyncio.sleep(0.02)
        assert dispatched == []
        available = 1
        engine.notify_capacity_changed()
        await asyncio.wait_for(task, timeout=1)
    finally:
        await engine.close()

    assert dispatched == ["cold"]
