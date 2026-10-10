import asyncio
from types import SimpleNamespace

import pytest

from app.scaling.controller import ScalingController
from app.scaling.worker_manager import WorkerManager


class FakeRepository:
    def __init__(self):
        self.events = []

    def save_worker_event(self, *args):
        self.events.append(args)


class FakePool:
    def __init__(self):
        self.entries = []


class FakeClient:
    async def list_owned(self):
        return []


def app_fixture():
    settings = SimpleNamespace(
        docker_worker_manager_enabled=True, scaling_dry_run=False,
        inference_mode="real",
        docker_socket_path="unused", docker_worker_owner="test", docker_worker_image="image",
        docker_worker_network="network", docker_worker_idle_timeout_seconds=1,
        docker_worker_startup_timeout_seconds=1, docker_worker_poll_seconds=1,
        request_timeout_seconds=10, backend_ollama_model="model",
    )
    return SimpleNamespace(state=SimpleNamespace(
        settings=settings, scaling=ScalingController(1, 5, False, 1),
        backend_pool=FakePool(), repository=FakeRepository(),
    ))


@pytest.mark.asyncio
async def test_concurrent_scale_up_is_serialized_without_duplicate_capacity():
    app = app_fixture()
    manager = WorkerManager(app, FakeClient())

    async def start_one():
        await asyncio.sleep(0)
        app.state.backend_pool.entries.append(SimpleNamespace())

    manager._start_one = start_one
    await asyncio.gather(manager.ensure_capacity(4, 0), manager.ensure_capacity(4, 0))
    assert len(app.state.backend_pool.entries) == 4


def test_manager_is_disabled_when_scaling_is_dry_run():
    app = app_fixture()
    app.state.settings.scaling_dry_run = True
    assert WorkerManager(app, FakeClient()).enabled is False
