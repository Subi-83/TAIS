from app.backends.pool import BackendPool
from app.core.config import Settings


def pool() -> BackendPool:
    return BackendPool(Settings(
        inference_mode="real",
        llm_provider="ollama",
        ollama_base_url="http://ollama:11434",
        backend_ollama_model="gemma4:12b",
    ))


def test_configured_replica_count_creates_independent_workers():
    backend_pool = pool()

    assert backend_pool.set_model_replicas("gemma4:12b", 4) == 4
    assert backend_pool.capacity() == 4
    assert len(backend_pool.snapshot()) == 4
    assert len({item["backend_id"] for item in backend_pool.snapshot()}) == 4
    assert all(item["max_concurrency"] == 1 for item in backend_pool.snapshot())
    assert len({id(entry.resilience) for entry in backend_pool.entries}) == 4


def test_replica_pool_dispatches_to_distinct_available_workers():
    backend_pool = pool()
    backend_pool.set_model_replicas("gemma4:12b", 4)

    selected = []
    for _ in range(4):
        entry = backend_pool.select("gemma4:12b")
        entry.active += 1
        selected.append(entry.backend_id)

    assert len(set(selected)) == 4


def test_rescaling_keeps_canonical_names_and_round_robins_equal_load():
    backend_pool = pool()
    backend_pool.set_model_replicas("gemma4:12b", 3)
    backend_pool.set_model_replicas("gemma4:12b", 3)

    assert [entry.backend_id for entry in backend_pool.entries] == [
        "ollama-gemma4-1-replica-1",
        "ollama-gemma4-1-replica-2",
        "ollama-gemma4-1-replica-3",
    ]
    selections = [backend_pool.select("gemma4:12b").backend_id for _ in range(6)]
    assert selections == [
        "ollama-gemma4-1-replica-1",
        "ollama-gemma4-1-replica-2",
        "ollama-gemma4-1-replica-3",
        "ollama-gemma4-1-replica-1",
        "ollama-gemma4-1-replica-2",
        "ollama-gemma4-1-replica-3",
    ]


def test_distinct_configured_worker_endpoints_are_preserved(monkeypatch):
    configured = Settings(
        inference_mode="real",
        llm_provider="ollama",
        ollama_base_url="http://host-ollama:11434",
        backend_ollama_model="gemma4:12b",
        llm_backends_json='['
            '{"id":"worker-1","provider":"ollama","base_url":"http://worker-1:8100","model":"gemma4:12b"},'
            '{"id":"worker-2","provider":"ollama","base_url":"http://worker-2:8100","model":"gemma4:12b"},'
            '{"id":"worker-3","provider":"ollama","base_url":"http://worker-3:8100","model":"gemma4:12b"}'
        ']',
    )
    backend_pool = BackendPool(configured)

    assert backend_pool.set_model_replicas("gemma4:12b", 3) == 3
    assert [entry.backend_id for entry in backend_pool.entries] == ["worker-1", "worker-2", "worker-3"]
    assert [entry.adapter.base_url for entry in backend_pool.entries] == [
        "http://worker-1:8100", "http://worker-2:8100", "http://worker-3:8100"
    ]


def test_configured_model_remains_supported_after_scale_to_zero():
    backend_pool = pool()
    backend_pool.entries.clear()

    assert backend_pool.capacity() == 0
    assert backend_pool.supports_model("gemma4:12b") is True
    assert backend_pool.supports_model("unknown-model") is False
