from app.metrics.collector import MetricsCollector, RequestMetric


def test_queue_wait_distribution_and_starvation_are_measured_per_experiment():
    collector = MetricsCollector(starvation_threshold_ms=300)
    for wait in (10, 75, 200, 301, 900):
        collector.record("exp-1", RequestMetric(wait, 100, 80, 2, 20, 4, 5, 6))
    collector.record("exp-2", RequestMetric(1000, 100, 80, 2, 20, 4, 5, 6))

    metrics = collector.snapshot("exp-1")

    assert metrics["completed"] == 5
    assert metrics["starvation_threshold_ms"] == 300
    assert metrics["starvation_rate_pct"] == 40
    assert metrics["queue_wait_distribution_pct"] == {
        "under_50": 20,
        "50_to_150": 20,
        "150_to_threshold": 20,
        "over_threshold": 40,
    }


def test_empty_experiment_has_zero_starvation_instead_of_nan():
    metrics = MetricsCollector().snapshot("empty")

    assert metrics["starvation_rate_pct"] == 0
    assert all(value == 0 for value in metrics["queue_wait_distribution_pct"].values())


def test_completion_latency_and_ttft_include_arithmetic_averages():
    collector = MetricsCollector()
    collector.record("exp", RequestMetric(0, 100, 90, 1, 10, 5, 10, 12))
    collector.record("exp", RequestMetric(0, 200, 190, 1, 30, 6, 20, 16))
    collector.record("exp", RequestMetric(0, 600, 590, 1, 80, 7, 30, 33))

    metrics = collector.snapshot("exp")

    assert metrics["completion_latency_ms"]["avg"] == 300
    assert metrics["ttft_ms"]["avg"] == 40
    assert metrics["prediction_error"]["valid_samples"] == 3


def test_percentiles_use_nearest_rank_and_zero_outputs_are_excluded_from_relative_error():
    collector = MetricsCollector()
    for latency in range(1, 21):
        collector.record("exp", RequestMetric(0, latency, latency, 0, latency, 2, 0 if latency == 1 else 10, 8))

    metrics = collector.snapshot("exp")

    assert metrics["completion_latency_ms"]["p95"] == 19
    assert metrics["completion_latency_ms"]["p99"] == 20
    assert metrics["prediction_error"]["valid_samples"] == 19
    assert metrics["prediction_error"]["excluded_zero_output_samples"] == 1
