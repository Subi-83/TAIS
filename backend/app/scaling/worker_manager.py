import asyncio
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx


OWNER_LABEL = "com.tais.worker-owner"
ROLE_LABEL = "com.tais.role"
WORKER_ID_LABEL = "com.tais.worker-id"
ENDPOINT_LABEL = "com.tais.endpoint"


class DockerEngineClient:
    """Minimal Docker Engine client restricted to labelled TAIS workers."""

    def __init__(self, socket_path: str, owner: str) -> None:
        self.owner = owner
        self._transport = httpx.AsyncHTTPTransport(uds=socket_path)

    async def _request(self, method: str, path: str, **kwargs):
        async with httpx.AsyncClient(transport=self._transport, base_url="http://docker", timeout=30) as client:
            response = await client.request(method, path, **kwargs)
            response.raise_for_status()
            return response

    async def list_owned(self) -> list[dict]:
        filters = f'{{"label":["{OWNER_LABEL}={self.owner}","{ROLE_LABEL}=inference-worker"]}}'
        return (await self._request("GET", "/containers/json", params={"all": "1", "filters": filters})).json()

    async def create(self, name: str, image: str, network: str, env: list[str]) -> str:
        body = {
            "Image": image,
            "Cmd": ["uvicorn", "ollama_worker.main:app", "--host", "0.0.0.0", "--port", "8100"],
            "Env": env,
            "Labels": {OWNER_LABEL: self.owner, ROLE_LABEL: "inference-worker", WORKER_ID_LABEL: name, ENDPOINT_LABEL: f"http://{name}:8100"},
            "HostConfig": {"NetworkMode": network, "ExtraHosts": ["host.docker.internal:host-gateway"]},
        }
        result = (await self._request("POST", "/containers/create", params={"name": name}, json=body)).json()
        await self._request("POST", f"/containers/{result['Id']}/start")
        return result["Id"]

    async def stop_remove(self, container_id: str) -> None:
        owned = {item["Id"] for item in await self.list_owned()}
        if container_id not in owned:
            raise RuntimeError("refusing to stop a container not owned by the TAIS worker manager")
        try:
            await self._request("POST", f"/containers/{container_id}/stop", params={"t": "10"})
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 304:
                raise
        await self._request("DELETE", f"/containers/{container_id}", params={"v": "1"})


class WorkerManager:
    """Serializes real worker scale decisions and drains temporary workers safely."""

    def __init__(self, app, client=None) -> None:
        self.app = app
        self.settings = app.state.settings
        self.enabled = (
            self.settings.docker_worker_manager_enabled
            and not self.settings.scaling_dry_run
            and self.settings.inference_mode in {"real", "hybrid"}
            and app.state.backend_pool is not None
        )
        self.client = client or DockerEngineClient(self.settings.docker_socket_path, self.settings.docker_worker_owner)
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._idle_since: dict[str, float] = {}
        self._sequence = 0
        self.last_error: str | None = None

    def start(self) -> None:
        if self.enabled:
            self._task = asyncio.create_task(self._loop())

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def _record(self, event_type: str, worker_id: str | None, container_id: str | None, **details) -> None:
        details.update({"desired_workers": self.app.state.scaling.state.desired_replicas, "actual_workers": len(self.app.state.backend_pool.entries), "timestamp": datetime.now(UTC).isoformat()})
        self.app.state.repository.save_worker_event(str(uuid4()), event_type, worker_id, container_id, details)

    async def reconcile_existing(self) -> None:
        if not self.enabled:
            return
        async with self._lock:
            known_container_ids = {entry.container_id for entry in self.app.state.backend_pool.entries if entry.container_id}
            owned = await self.client.list_owned()
            for item in owned:
                if item["Id"] in known_container_ids:
                    continue
                labels = item.get("Labels") or {}
                names = item.get("Names") or []
                name = labels.get(WORKER_ID_LABEL) or (names[0].lstrip("/") if names else item["Id"][:12])
                endpoint = labels.get(ENDPOINT_LABEL) or f"http://{name}:8100"
                if item.get("State") == "running":
                    self.app.state.backend_pool.add_worker(name, endpoint, self.settings.backend_ollama_model, item["Id"])
                    self._record("worker_reconciled", name, item["Id"], endpoint=endpoint)
            # BackendPool starts with a configured DNS placeholder. In manager
            # mode it is not actual capacity unless an owned container exists.
            self.app.state.backend_pool.entries = [
                entry for entry in self.app.state.backend_pool.entries
                if entry.container_id is not None or entry.active > 0
            ]

    async def ensure_capacity(self, queued: int, active: int) -> None:
        desired = self.app.state.scaling.capacity(queued, active)
        if not self.enabled:
            return
        async with self._lock:
            pool = self.app.state.backend_pool
            while len(pool.entries) < desired:
                await self._start_one()

    async def _start_one(self) -> None:
        self._sequence += 1
        worker_id = f"tais-dynamic-worker-{int(time.time())}-{self._sequence}"
        started = time.monotonic()
        self._record("worker_starting", worker_id, None, reason="demand exceeded healthy capacity")
        try:
            container_id = await self.client.create(worker_id, self.settings.docker_worker_image, self.settings.docker_worker_network, [
                "OLLAMA_BASE_URL=http://host.docker.internal:11434",
                f"WORKER_ID={worker_id}",
                f"REQUEST_TIMEOUT_SECONDS={self.settings.request_timeout_seconds}",
            ])
            endpoint = f"http://{worker_id}:8100"
            deadline = time.monotonic() + self.settings.docker_worker_startup_timeout_seconds
            async with httpx.AsyncClient(timeout=2) as client:
                while True:
                    try:
                        response = await client.get(f"{endpoint}/worker/health")
                        response.raise_for_status()
                        break
                    except Exception:
                        if time.monotonic() >= deadline:
                            raise TimeoutError(f"worker {worker_id} did not become ready")
                        await asyncio.sleep(0.5)
            self.app.state.backend_pool.add_worker(worker_id, endpoint, self.settings.backend_ollama_model, container_id)
            self.app.state.gateway.scheduler.notify_capacity_changed()
            self._record("worker_ready", worker_id, container_id, endpoint=endpoint, startup_ms=(time.monotonic() - started) * 1000, health="healthy")
        except Exception as exc:
            self.last_error = str(exc)
            self._record("worker_start_failed", worker_id, locals().get("container_id"), error=str(exc), startup_ms=(time.monotonic() - started) * 1000)
            if locals().get("container_id"):
                try:
                    await self.client.stop_remove(container_id)
                except Exception:
                    pass
            raise

    async def scale_down_idle(self) -> None:
        if not self.enabled:
            return
        async with self._lock:
            pool = self.app.state.backend_pool
            minimum = self.app.state.scaling.state.min_replicas
            temporary = [entry for entry in pool.entries if entry.temporary]
            now = time.monotonic()
            for entry in reversed(temporary):
                if len(pool.entries) <= minimum:
                    break
                if entry.active:
                    self._idle_since.pop(entry.backend_id, None)
                    continue
                idle_since = self._idle_since.setdefault(entry.backend_id, now)
                if now - idle_since < self.settings.docker_worker_idle_timeout_seconds:
                    continue
                entry.lifecycle_state = "draining"
                self._record("worker_draining", entry.backend_id, entry.container_id, reason="idle timeout", active_requests=entry.active)
                if entry.active or not pool.remove_worker(entry.backend_id):
                    entry.lifecycle_state = "ready"
                    continue
                try:
                    await self.client.stop_remove(entry.container_id)
                    self._record("worker_removed", entry.backend_id, entry.container_id, reason="idle timeout", shutdown_result="removed")
                    self._idle_since.pop(entry.backend_id, None)
                except Exception as exc:
                    pool.add_worker(entry.backend_id, entry.base_url, entry.model, entry.container_id, entry.max_concurrency)
                    self.last_error = str(exc)
                    self._record("worker_stop_failed", entry.backend_id, entry.container_id, error=str(exc))

    async def _loop(self) -> None:
        await self.reconcile_existing()
        while True:
            await self.reconcile_existing()
            engine = self.app.state.gateway.scheduler
            await self.ensure_capacity(len(engine.pending), len(engine.active))
            if not engine.pending and not engine.active:
                self.app.state.scaling.evaluate(0, 0)
                await self.scale_down_idle()
            await asyncio.sleep(self.settings.docker_worker_poll_seconds)

    def snapshot(self) -> dict:
        pool = self.app.state.backend_pool
        entries = pool.entries if pool else []
        return {
            "enabled": self.enabled,
            "mode": "real" if self.enabled else "dry_run",
            "desired_workers": self.app.state.scaling.state.desired_replicas,
            "actual_workers": len(entries),
            "actual_replicas": len(entries),
            "healthy_workers": sum(item.healthy for item in entries),
            "busy_workers": sum(item.active > 0 for item in entries),
            "idle_workers": sum(item.active == 0 and item.healthy for item in entries),
            "starting_workers": sum(item.lifecycle_state == "starting" for item in entries),
            "draining_workers": sum(item.lifecycle_state == "draining" for item in entries),
            "last_error": self.last_error,
        }
