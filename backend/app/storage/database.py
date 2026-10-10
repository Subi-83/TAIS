import json
from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class ExperimentRow(Base):
    __tablename__ = "experiments"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(30))
    configuration: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RequestRow(Base):
    __tablename__ = "request_lifecycle"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    experiment_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30))
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    metrics_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class WorkerEventRow(Base):
    __tablename__ = "worker_lifecycle_events"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    worker_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    container_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class FaultObservationRow(Base):
    __tablename__ = "fault_recovery_observations"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(100), index=True)
    experiment_id: Mapped[str] = mapped_column(String(100), index=True)
    policy: Mapped[str] = mapped_column(String(30), index=True)
    phase: Mapped[str] = mapped_column(String(50))
    phase_order: Mapped[int] = mapped_column()
    data_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Repository:
    def __init__(self, database_url: str) -> None:
        self.engine = create_engine(database_url, future=True)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def save_experiment(self, item: dict) -> None:
        with self.sessions.begin() as session:
            row = session.get(ExperimentRow, item["experiment_id"])
            if row is None:
                row = ExperimentRow(id=item["experiment_id"], name=item["name"], status=item["status"], configuration="{}", created_at=datetime.now(UTC))
                session.add(row)
            row.status = item["status"]
            row.configuration = json.dumps({key: value for key, value in item.items() if not key.startswith("_")}, default=str)

    def load_experiments(self) -> dict[str, dict]:
        with self.sessions() as session:
            rows = session.query(ExperimentRow).order_by(ExperimentRow.created_at).all()
            return {row.id: json.loads(row.configuration) for row in rows}

    def save_request(self, request_id: str, experiment_id: str | None, model: str, status: str, metadata: dict | None = None, metrics: dict | None = None) -> None:
        now = datetime.now(UTC)
        with self.sessions.begin() as session:
            row = session.get(RequestRow, request_id)
            if row is None:
                row = RequestRow(id=request_id, experiment_id=experiment_id, model=model, status=status, created_at=now, updated_at=now)
                session.add(row)
            row.status, row.updated_at = status, now
            if metadata is not None:
                current_metadata = json.loads(row.metadata_json or "{}")
                row.metadata_json = json.dumps({**current_metadata, **metadata}, default=str)
            if metrics is not None:
                current_metrics = json.loads(row.metrics_json or "{}")
                row.metrics_json = json.dumps({**current_metrics, **metrics}, default=str)

    def request_counts(self, experiment_id: str) -> dict[str, int]:
        with self.sessions() as session:
            rows = session.query(RequestRow.status).filter(RequestRow.experiment_id == experiment_id).all()
            counts = {"queued": 0, "running": 0, "completed": 0, "failed": 0, "cancelled": 0}
            for (status,) in rows:
                counts[status] = counts.get(status, 0) + 1
            return counts

    def request_records(self, experiment_id: str) -> list[dict]:
        with self.sessions() as session:
            rows = session.query(RequestRow).filter(RequestRow.experiment_id == experiment_id).order_by(RequestRow.created_at).all()
            return [{
                "request_id": row.id,
                "experiment_id": row.experiment_id,
                "model": row.model,
                "status": row.status,
                "metadata": json.loads(row.metadata_json or "{}"),
                "metrics": json.loads(row.metrics_json or "{}"),
                "created_at": row.created_at.isoformat(),
                "updated_at": row.updated_at.isoformat(),
            } for row in rows]

    def save_worker_event(self, event_id: str, event_type: str, worker_id: str | None, container_id: str | None, details: dict) -> None:
        with self.sessions.begin() as session:
            session.add(WorkerEventRow(id=event_id, event_type=event_type, worker_id=worker_id, container_id=container_id, details_json=json.dumps(details, default=str), created_at=datetime.now(UTC)))

    def worker_events(self, limit: int = 200) -> list[dict]:
        with self.sessions() as session:
            rows = session.query(WorkerEventRow).order_by(WorkerEventRow.created_at.desc()).limit(limit).all()
            return [{"event_id": row.id, "event_type": row.event_type, "worker_id": row.worker_id, "container_id": row.container_id, "details": json.loads(row.details_json or "{}"), "timestamp": row.created_at.isoformat()} for row in reversed(rows)]

    def save_fault_observation(self, item: dict) -> None:
        with self.sessions.begin() as session:
            session.add(FaultObservationRow(id=item["observation_id"], run_id=item["run_id"], experiment_id=item["experiment_id"], policy=item["policy"], phase=item["phase"], phase_order=item["phase_order"], data_json=json.dumps(item, default=str), created_at=datetime.now(UTC)))

    def latest_fault_observations(self) -> dict | None:
        with self.sessions() as session:
            latest = session.query(FaultObservationRow).order_by(FaultObservationRow.created_at.desc()).first()
            if not latest:
                return None
            rows = session.query(FaultObservationRow).filter(FaultObservationRow.run_id == latest.run_id).order_by(FaultObservationRow.phase_order, FaultObservationRow.policy).all()
            return {"run_id": latest.run_id, "observations": [json.loads(row.data_json) for row in rows]}

    def token_prediction_history(self, model: str) -> list[dict]:
        with self.sessions() as session:
            rows = session.query(RequestRow).filter(RequestRow.model == model, RequestRow.status == "completed").all()
            history = []
            for row in rows:
                metadata = json.loads(row.metadata_json or "{}")
                metrics = json.loads(row.metrics_json or "{}")
                actual = metrics.get("actual_output_tokens")
                if actual is None:
                    continue
                history.append({
                    "question_id": metadata.get("question_id"),
                    "difficulty": metadata.get("difficulty"),
                    "profile": metadata.get("profile"),
                    "actual_output_tokens": int(actual),
                })
            return history

    def close(self) -> None:
        self.engine.dispose()
