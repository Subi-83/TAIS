import asyncio
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from app.models.requests import InferenceRequest, InferenceResponse


@dataclass
class QueuedRequest:
    request_id: str
    payload: InferenceRequest
    created_at: float
    input_tokens: int
    future: asyncio.Future[InferenceResponse]
    received_at: float | None = None
    prediction_latency_ms: float = 0
    output_token_weight: float = 1.0
    cancelled: bool = False
    overdue_at_dispatch: bool = False
    bypassed: int = 0
    selection_reason: str = "pending"

    @property
    def estimated_tokens(self) -> int:
        return round(self.input_tokens + self.output_token_weight * (self.payload.expected_output_tokens or self.payload.max_output_tokens))


class SchedulerEngine:
    """Single-dispatcher scheduler; policies select real execution order with age promotion."""

    def __init__(
        self,
        execute: Callable[[QueuedRequest], Awaitable[InferenceResponse]],
        policy: str = "fifo",
        max_queue: int = 1000,
        max_wait_seconds: float = 30,
        aging_weight: float = 1.0,
        max_bypass: int = 8,
        capacity: Callable[[int, int], int] | None = None,
    ) -> None:
        self.execute = execute
        self.policy = policy
        self.max_queue = max_queue
        self.max_wait_seconds = max_wait_seconds
        self.aging_weight = aging_weight
        self.max_bypass = max_bypass
        self.capacity = capacity or (lambda queued, active: 1)
        self.pending: list[QueuedRequest] = []
        self.active: dict[str, QueuedRequest] = {}
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.overdue_dispatched = 0

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    def notify_capacity_changed(self) -> None:
        self._wake.set()

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def submit(self, item: QueuedRequest) -> InferenceResponse:
        if len(self.pending) >= self.max_queue:
            raise RuntimeError("request queue is full")
        self.pending.append(item)
        self._wake.set()
        return await item.future

    def cancel(self, request_id: str) -> bool:
        for item in self.pending:
            if item.request_id == request_id:
                item.cancelled = True
                if not item.future.done():
                    item.future.cancel()
                return True
        return False

    def _next(self) -> QueuedRequest | None:
        candidates = [item for item in self.pending if not item.cancelled]
        self.pending = candidates
        if not candidates:
            return None
        now = time.monotonic()
        overdue = [item for item in candidates if now - item.created_at >= self.max_wait_seconds or item.bypassed >= self.max_bypass]
        if overdue:
            chosen = min(overdue, key=lambda item: (item.created_at, item.request_id))
            chosen.overdue_at_dispatch = True
            chosen.selection_reason = "maximum_wait" if now - chosen.created_at >= self.max_wait_seconds else "maximum_bypass"
            self.overdue_dispatched += 1
        elif self.policy == "token_aware":
            # Lower score runs first. Waiting continuously lowers the score so a
            # large request cannot starve behind an endless stream of small ones.
            chosen = min(
                candidates,
                key=lambda item: (
                    item.estimated_tokens - self.aging_weight * (now - item.created_at),
                    item.created_at,
                    item.request_id,
                ),
            )
            chosen.selection_reason = "token_aware_aging"
        else:
            chosen = min(candidates, key=lambda item: (item.created_at, item.request_id))
            chosen.selection_reason = "fifo"
        self.pending.remove(chosen)
        for item in self.pending:
            if item.created_at < chosen.created_at:
                item.bypassed += 1
        return chosen

    def overdue_waiting(self) -> int:
        now = time.monotonic()
        return sum(not item.cancelled and now - item.created_at >= self.max_wait_seconds for item in self.pending)

    async def _run(self) -> None:
        while True:
            capacity = max(0, self.capacity(len(self.pending), len(self.active)))
            if capacity == 0:
                self._wake.clear()
                await self._wake.wait()
                continue
            if len(self.active) >= capacity:
                self._wake.clear()
                await self._wake.wait()
                continue
            item = self._next()
            if not item:
                self._wake.clear()
                await self._wake.wait()
                continue
            self.active[item.request_id] = item
            asyncio.create_task(self._execute_one(item))

    async def _execute_one(self, item: QueuedRequest) -> None:
        try:
            result = await self.execute(item)
            if not item.future.done():
                item.future.set_result(result)
        except Exception as exc:
            if not item.future.done():
                item.future.set_exception(exc)
        finally:
            self.active.pop(item.request_id, None)
            self._wake.set()
