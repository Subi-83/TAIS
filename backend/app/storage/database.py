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

    def save_request(self, request_id: str, experiment_id: str | None, model: str, status: str, metadata: dict | None = None, metrics: dict | None = None) -> None:
        now = datetime.now(UTC)
        with self.sessions.begin() as session:
            row = session.get(RequestRow, request_id)
            if row is None:
                row = RequestRow(id=request_id, experiment_id=experiment_id, model=model, status=status, created_at=now, updated_at=now)
                session.add(row)
            row.status, row.updated_at = status, now
            if metadata is not None:
                row.metadata_json = json.dumps(metadata, default=str)
            if metrics is not None:
                row.metrics_json = json.dumps(metrics, default=str)

    def close(self) -> None:
        self.engine.dispose()
