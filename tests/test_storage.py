from sqlalchemy import select

from app.storage.database import RequestRow, Repository


def test_repository_persists_and_updates_request_lifecycle(tmp_path):
    repository = Repository(f"sqlite:///{tmp_path / 'test.db'}")
    repository.save_request("r1", "e1", "mock-echo-1", "queued", {"safe": "metadata"})
    repository.save_request("r1", "e1", "mock-echo-1", "completed", metrics={"output_tokens": 3})
    with repository.sessions() as session:
        row = session.scalar(select(RequestRow).where(RequestRow.id == "r1"))
    assert row.status == "completed"
    assert '"output_tokens": 3' in row.metrics_json
    repository.close()
