import asyncio
import json
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from itertools import count
from typing import Any


@dataclass(frozen=True)
class Event:
    id: int
    event: str
    data: dict[str, Any]
    timestamp: str
    experiment_id: str


class EventPublisher:
    """Best-effort bounded SSE publisher; slow subscribers drop events, never inference."""

    def __init__(self, history_size: int = 500, subscriber_size: int = 100) -> None:
        self._history_size = history_size
        self._subscriber_size = subscriber_size
        self._ids = count(1)
        self._history: dict[str, deque[Event]] = defaultdict(lambda: deque(maxlen=self._history_size))
        self._subscribers: dict[str, set[asyncio.Queue[Event]]] = defaultdict(set)

    async def publish(self, experiment_id: str | None, event: str, data: dict[str, Any]) -> None:
        if not experiment_id:
            return
        item = Event(next(self._ids), event, data, datetime.now(UTC).isoformat(), experiment_id)
        self._history[experiment_id].append(item)
        for queue in tuple(self._subscribers[experiment_id]):
            try:
                queue.put_nowait(item)
            except asyncio.QueueFull:
                # A slow client must resync through the experiment snapshot.
                try:
                    queue.get_nowait()
                    queue.put_nowait(Event(item.id, "stream_resync_required", {}, item.timestamp, experiment_id))
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    async def subscribe(self, experiment_id: str, last_event_id: int | None = None) -> AsyncIterator[str]:
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=self._subscriber_size)
        for item in self._history[experiment_id]:
            if last_event_id is None or item.id > last_event_id:
                queue.put_nowait(item)
        self._subscribers[experiment_id].add(queue)
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                    data = {**asdict(item), "data": item.data}
                    yield f"id: {item.id}\nevent: {item.event}\ndata: {json.dumps(data, default=str)}\n\n"
                except TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            self._subscribers[experiment_id].discard(queue)
