from collections import defaultdict
from dataclasses import dataclass
from statistics import quantiles


def percentile(values: list[float], point: int) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    return quantiles(values, n=100, method="inclusive")[point - 1]


@dataclass
class RequestMetric:
    queue_wait_ms: float
    completion_ms: float
    ttft_ms: float | None
    output_tokens: int


class MetricsCollector:
    def __init__(self) -> None:
        self.completed = 0
        self.failed = 0
        self.cancelled = 0
        self._metrics: dict[str, list[RequestMetric]] = defaultdict(list)

    def record(self, experiment_id: str | None, metric: RequestMetric) -> None:
        self.completed += 1
        if experiment_id:
            self._metrics[experiment_id].append(metric)

    def snapshot(self, experiment_id: str | None = None) -> dict:
        values = self._metrics.get(experiment_id, []) if experiment_id else [m for group in self._metrics.values() for m in group]
        waits = [m.queue_wait_ms for m in values]
        latencies = [m.completion_ms for m in values]
        ttfts = [m.ttft_ms for m in values if m.ttft_ms is not None]
        return {
            "completed": self.completed,
            "failed": self.failed,
            "cancelled": self.cancelled,
            "samples": len(values),
            "queue_wait_ms": {"p50": percentile(waits, 50), "p95": percentile(waits, 95), "p99": percentile(waits, 99)},
            "completion_latency_ms": {"p50": percentile(latencies, 50), "p95": percentile(latencies, 95), "p99": percentile(latencies, 99)},
            "ttft_ms": {"p50": percentile(ttfts, 50), "p95": percentile(ttfts, 95), "p99": percentile(ttfts, 99)},
            "output_tokens": sum(m.output_tokens for m in values),
        }
