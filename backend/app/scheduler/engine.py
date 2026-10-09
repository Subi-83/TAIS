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
    cancelled: bool = False

    @property
    def estimated_tokens(self) -> int:
        return self.input_tokens + (self.payload.expected_output_tokens or self.payload.max_output_tokens)


class SchedulerEngine:
    """Single-dispatcher scheduler; policies select real execution order with age promotion."""

    def __init__(
        self,
        execute: Callable[[QueuedRequest], Awaitable[InferenceResponse]],
        policy: str = "fifo",
        max_queue: int = 1000,
        max_wait_seconds: float = 30,
    ) -> None:
        self.execute = execute
        self.policy = policy
        self.max_queue = max_queue
        self.max_wait_seconds = max_wait_seconds
        self.pending: list[QueuedRequest] = []
        self.active: QueuedRequest | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

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
        aged = [item for item in candidates if now - item.created_at >= self.max_wait_seconds]
        if aged:
            chosen = min(aged, key=lambda item: item.created_at)
        elif self.policy == "token_aware":
            priority_bonus = {"high": -100_000, "normal": 0, "low": 100_000}
            chosen = min(candidates, key=lambda item: (item.estimated_tokens + priority_bonus[item.payload.priority], item.created_at))
        else:
            chosen = min(candidates, key=lambda item: item.created_at)
        self.pending.remove(chosen)
        return chosen

    async def _run(self) -> None:
        while True:
            item = self._next()
            if not item:
                self._wake.clear()
                await self._wake.wait()
                continue
            self.active = item
            try:
                result = await self.execute(item)
                if not item.future.done():
                    item.future.set_result(result)
            except Exception as exc:
                if not item.future.done():
                    item.future.set_exception(exc)
            finally:
                self.active = None
