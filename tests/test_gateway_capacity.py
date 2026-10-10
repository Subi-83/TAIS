from types import SimpleNamespace

from app.gateway.service import InferenceGateway


class StubPool:
    def capacity(self) -> int:
        return 6


class StubScaling:
    def capacity(self, queued: int, active: int) -> int:
        return 1


def test_real_backend_concurrency_respects_replica_planner(monkeypatch):
    monkeypatch.setattr("app.gateway.service.TokenCounter", lambda *_: object())
    app = SimpleNamespace(
        state=SimpleNamespace(
            settings=SimpleNamespace(
                llm_tokenizer_id=None,
                scheduler_policy="fifo",
                scheduler_max_queue=1000,
                scheduler_max_wait_seconds=30,
                scheduler_aging_weight=1,
            ),
            scaling=StubScaling(),
            backend_pool=StubPool(),
        )
    )

    gateway = InferenceGateway(app)

    assert gateway.scheduler.capacity(10, 0) == 1
