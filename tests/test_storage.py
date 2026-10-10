from sqlalchemy import select

from app.storage.database import RequestRow, Repository


def test_repository_persists_and_updates_request_lifecycle(tmp_path):
    repository = Repository(f"sqlite:///{tmp_path / 'test.db'}")
    repository.save_request("r1", "e1", "mock-echo-1", "queued", {"safe": "metadata"})
    repository.save_request("r1", "e1", "mock-echo-1", "running", metrics={"processing_started_at": "now"})
    repository.save_request("r1", "e1", "mock-echo-1", "completed", metrics={"output_tokens": 3})
    with repository.sessions() as session:
        row = session.scalar(select(RequestRow).where(RequestRow.id == "r1"))
    assert row.status == "completed"
    assert '"output_tokens": 3' in row.metrics_json
    assert '"processing_started_at": "now"' in row.metrics_json
    repository.close()


def test_repository_keeps_experiment_metrics_isolated(tmp_path):
    repository = Repository(f"sqlite:///{tmp_path / 'isolated.db'}")
    repository.save_request("r1", "fifo", "model", "completed", metrics={"total_latency_ms": 10})
    repository.save_request("r2", "token", "model", "completed", metrics={"total_latency_ms": 20})

    fifo = repository.request_records("fifo")
    token = repository.request_records("token")

    assert [row["request_id"] for row in fifo] == ["r1"]
    assert fifo[0]["metrics"]["total_latency_ms"] == 10
    assert [row["request_id"] for row in token] == ["r2"]
    repository.close()
