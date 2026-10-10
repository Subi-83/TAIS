from collections import defaultdict
from dataclasses import dataclass
from math import ceil


def percentile(values: list[float], point: int) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = ceil((point / 100) * len(ordered))
    return ordered[max(0, rank - 1)]


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


@dataclass
class RequestMetric:
    queue_wait_ms: float
    total_latency_ms: float
    inference_latency_ms: float
    prediction_latency_ms: float
    ttft_ms: float | None
    input_tokens: int
    output_tokens: int
    predicted_output_tokens: int
    overdue_at_dispatch: bool = False
    bypassed: int = 0


class MetricsCollector:
    def __init__(self, starvation_threshold_ms: float = 2000, slowdown_limit: float = 3.0, max_bypass: int = 8) -> None:
        self.completed = 0
        self.failed = 0
        self.cancelled = 0
        self._metrics: dict[str, list[RequestMetric]] = defaultdict(list)
        self.starvation_threshold_ms = starvation_threshold_ms
        self.slowdown_limit = slowdown_limit
        self.max_bypass = max_bypass

    def record(self, experiment_id: str | None, metric: RequestMetric) -> None:
        self.completed += 1
        if experiment_id:
            self._metrics[experiment_id].append(metric)

    def snapshot(self, experiment_id: str | None = None) -> dict:
        values = self._metrics.get(experiment_id, []) if experiment_id else [m for group in self._metrics.values() for m in group]
        waits = [m.queue_wait_ms for m in values]
        latencies = [m.total_latency_ms for m in values]
        inference_latencies = [m.inference_latency_ms for m in values]
        prediction_latencies = [m.prediction_latency_ms for m in values]
        ttfts = [m.ttft_ms for m in values if m.ttft_ms is not None]
        valid_predictions = [m for m in values if m.output_tokens > 0]
        absolute_errors = [abs(m.output_tokens - m.predicted_output_tokens) for m in valid_predictions]
        relative_errors = [abs(m.output_tokens - m.predicted_output_tokens) / m.output_tokens * 100 for m in valid_predictions]
        slowdowns = [m.queue_wait_ms / max(m.inference_latency_ms, 1) for m in values]
        fairness_starved = [slowdown > self.slowdown_limit or metric.bypassed >= self.max_bypass for metric, slowdown in zip(values, slowdowns)]
        slowdown_sum = sum(slowdowns)
        jain_fairness = (slowdown_sum ** 2 / (len(slowdowns) * sum(value * value for value in slowdowns))) if slowdowns and sum(value * value for value in slowdowns) else 1.0
        sample_count = len(waits)
        bucket_counts = {
            "under_50": sum(wait < 50 for wait in waits),
            "50_to_150": sum(50 <= wait < 150 for wait in waits),
            "150_to_threshold": sum(150 <= wait <= self.starvation_threshold_ms for wait in waits),
            "over_threshold": sum(wait > self.starvation_threshold_ms for wait in waits),
        }
        queue_wait_distribution_pct = {
            key: (count * 100 / sample_count if sample_count else 0.0)
            for key, count in bucket_counts.items()
        }
        return {
            "completed": sample_count if experiment_id else self.completed,
            "failed": self.failed,
            "cancelled": self.cancelled,
            "samples": len(values),
            "queue_wait_ms": {"p50": percentile(waits, 50), "p95": percentile(waits, 95), "p99": percentile(waits, 99)},
            "queue_wait_average_ms": average(waits),
            "queue_wait_max_ms": max(waits) if waits else None,
            "queue_wait_distribution_pct": queue_wait_distribution_pct,
            "starvation_threshold_ms": self.starvation_threshold_ms,
            "starvation_eligible_requests": sample_count,
            "starved_requests": bucket_counts["over_threshold"],
            "starvation_rate_pct": queue_wait_distribution_pct["over_threshold"],
            "over_300ms_rate_pct": (sum(wait > 300 for wait in waits) * 100 / sample_count if sample_count else 0.0),
            "overdue_dispatched": sum(metric.overdue_at_dispatch for metric in values),
            "max_bypass": max((metric.bypassed for metric in values), default=0),
            "fairness_starvation_rate_pct": (sum(fairness_starved) * 100 / sample_count if sample_count else 0.0),
            "jain_fairness_on_slowdown": jain_fairness,
            "completion_latency_ms": {"avg": average(latencies), "p50": percentile(latencies, 50), "p95": percentile(latencies, 95), "p99": percentile(latencies, 99)},
            "inference_latency_ms": {"avg": average(inference_latencies), "p95": percentile(inference_latencies, 95)},
            "prediction_latency_ms": {"avg": average(prediction_latencies), "p95": percentile(prediction_latencies, 95)},
            "ttft_ms": {"avg": average(ttfts), "p50": percentile(ttfts, 50), "p95": percentile(ttfts, 95), "p99": percentile(ttfts, 99)},
            "prediction_error": {
                "valid_samples": len(valid_predictions),
                "excluded_zero_output_samples": len(values) - len(valid_predictions),
                "mean_absolute_tokens": average(absolute_errors),
                "mean_relative_percent": average(relative_errors),
            },
            "input_tokens": sum(m.input_tokens for m in values),
            "output_tokens": sum(m.output_tokens for m in values),
            "actual_total_tokens": sum(m.input_tokens + m.output_tokens for m in values),
        }
