import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.inference.mock_adapter import MockBackendError
from app.inference.openai_compatible import RealInferenceError

T = TypeVar("T")


class BackendUnavailableError(RuntimeError):
    pass


class BackendResilienceAgent:
    """Exponential retry and circuit-breaker agent for backend inference calls."""

    def __init__(self, max_retries: int, backoff_seconds: float, failure_threshold: int, recovery_seconds: float) -> None:
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self.failure_threshold = failure_threshold
        self.recovery_seconds = recovery_seconds
        self.consecutive_failures = 0
        self.open_until = 0.0
        self.total_retries = 0
        self.recoveries = 0
        self.last_error: str | None = None

    @property
    def state(self) -> str:
        if self.open_until > time.monotonic():
            return "open"
        return "half_open" if self.open_until else "closed"

    def snapshot(self) -> dict:
        return {"state": self.state, "consecutive_failures": self.consecutive_failures, "total_retries": self.total_retries, "recoveries": self.recoveries, "last_error": self.last_error, "retry_limit": self.max_retries}

    @staticmethod
    def _retryable(exc: Exception) -> bool:
        return isinstance(exc, MockBackendError) or (isinstance(exc, RealInferenceError) and exc.status_code >= 500)

    async def execute(self, operation: Callable[[], Awaitable[T]], on_event: Callable[[str, dict], Awaitable[None]]) -> T:
        if self.open_until > time.monotonic():
            raise BackendUnavailableError("backend circuit is open until the recovery probe window")
        was_half_open = bool(self.open_until)
        for attempt in range(self.max_retries + 1):
            try:
                result = await operation()
                if self.consecutive_failures or was_half_open:
                    self.recoveries += 1
                    await on_event("backend_recovered", {"message": "Backend recovered; circuit closed"})
                self.consecutive_failures = 0
                self.open_until = 0.0
                self.last_error = None
                return result
            except Exception as exc:
                if not self._retryable(exc):
                    raise
                self.consecutive_failures += 1
                self.last_error = str(exc)
                if self.consecutive_failures >= self.failure_threshold:
                    self.open_until = time.monotonic() + self.recovery_seconds
                    await on_event("backend_circuit_opened", {"message": str(exc), "recovery_seconds": self.recovery_seconds})
                if attempt >= self.max_retries:
                    raise
                self.total_retries += 1
                delay = self.backoff_seconds * (2**attempt)
                await on_event("backend_retry", {"message": str(exc), "attempt": attempt + 1, "delay_seconds": delay})
                await asyncio.sleep(delay)
        raise BackendUnavailableError("backend retry budget exhausted")
