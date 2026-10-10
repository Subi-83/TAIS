import json
import re
from dataclasses import dataclass
from typing import Any

from app.backends.resilience import BackendResilienceAgent, BackendUnavailableError
from app.inference.ollama_adapter import OllamaAdapter
from app.inference.openai_compatible import OpenAICompatibleAdapter, RealInferenceError


@dataclass
class BackendEntry:
    backend_id: str
    provider: str
    base_url: str
    model: str
    adapter: Any
    resilience: BackendResilienceAgent
    max_concurrency: int = 1
    active: int = 0
    healthy: bool = True
    container_id: str | None = None
    lifecycle_state: str = "ready"
    temporary: bool = False


class BackendPool:
    """Model-aware backend registry with least-loaded healthy dispatch."""

    def __init__(self, settings) -> None:
        self._settings = settings
        self._selection_cursor: dict[str, int] = {}
        raw = json.loads(settings.llm_backends_json) if settings.llm_backends_json else [{
            "id": "ollama-gemma4-1", "provider": settings.llm_provider,
            "base_url": settings.ollama_base_url or settings.llm_base_url,
            "model": settings.backend_ollama_model if settings.llm_provider == "ollama" else settings.llm_model_id,
            "max_concurrency": 1,
        }]
        self.entries: list[BackendEntry] = []
        for index, spec in enumerate(raw):
            backend_settings = settings.model_copy(update={
                "llm_provider": spec.get("provider", "ollama"),
                "llm_base_url": spec["base_url"],
                "ollama_base_url": spec["base_url"] if spec.get("provider", "ollama") == "ollama" else settings.ollama_base_url,
                "llm_model_id": spec["model"],
            })
            adapter = OllamaAdapter(backend_settings, model_id=spec["model"], component="backend") if backend_settings.llm_provider == "ollama" else OpenAICompatibleAdapter(backend_settings)
            agent = BackendResilienceAgent(settings.backend_max_retries, settings.backend_retry_backoff_seconds, settings.backend_circuit_failure_threshold, settings.backend_circuit_recovery_seconds)
            self.entries.append(BackendEntry(spec.get("id", f"backend-{index + 1}"), backend_settings.llm_provider, spec["base_url"], spec["model"], adapter, agent, spec.get("max_concurrency", 1)))
        self._configured_entries = list(self.entries)
        if not settings.llm_backends_json and settings.backend_replica_count > 1:
            self.set_model_replicas(self.entries[0].model, settings.backend_replica_count)

    def select(self, model: str) -> BackendEntry:
        candidates = [entry for entry in self.entries if entry.model == model and entry.healthy and entry.resilience.state != "open" and entry.active < entry.max_concurrency]
        if not candidates:
            served = sorted({entry.model for entry in self.entries})
            raise RealInferenceError(f"no healthy backend capacity for model '{model}'; available models: {served}", 503)
        lowest_load = min(entry.active for entry in candidates)
        least_loaded = [entry for entry in candidates if entry.active == lowest_load]
        cursor = self._selection_cursor.get(model, 0)
        selected = least_loaded[cursor % len(least_loaded)]
        self._selection_cursor[model] = cursor + 1
        return selected

    def capacity(self) -> int:
        return sum(entry.max_concurrency for entry in self.entries if entry.healthy and entry.resilience.state != "open")

    def supports_model(self, model: str) -> bool:
        """Configured capability survives scale-to-zero when no worker is active."""
        return any(entry.model == model for entry in self._configured_entries)

    def set_model_concurrency(self, model: str, max_requests: int) -> int:
        """Apply the operator-selected per-backend request cap for a model."""
        updated = 0
        for entry in self.entries:
            if entry.model == model:
                entry.max_concurrency = max_requests
                updated += 1
        return updated

    def add_worker(self, backend_id: str, base_url: str, model: str, container_id: str, max_concurrency: int = 1) -> BackendEntry:
        existing = next((entry for entry in self.entries if entry.backend_id == backend_id), None)
        if existing:
            existing.container_id = container_id
            existing.healthy = True
            existing.lifecycle_state = "ready"
            existing.temporary = True
            return existing
        backend_settings = self._settings.model_copy(update={"llm_provider": "ollama", "llm_base_url": base_url, "ollama_base_url": base_url, "llm_model_id": model})
        entry = BackendEntry(
            backend_id, "ollama", base_url, model,
            OllamaAdapter(backend_settings, model_id=model, component="backend"),
            BackendResilienceAgent(self._settings.backend_max_retries, self._settings.backend_retry_backoff_seconds, self._settings.backend_circuit_failure_threshold, self._settings.backend_circuit_recovery_seconds),
            max_concurrency=max_concurrency, container_id=container_id, temporary=True,
        )
        self.entries.append(entry)
        return entry

    def remove_worker(self, backend_id: str) -> bool:
        entry = next((item for item in self.entries if item.backend_id == backend_id), None)
        if not entry or not entry.temporary or entry.active:
            return False
        self.entries.remove(entry)
        return True

    def set_model_replicas(self, model: str, replica_count: int) -> int:
        """Create independently tracked workers for one configured model endpoint."""
        matching = [entry for entry in self.entries if entry.model == model]
        if not matching or any(entry.active for entry in matching):
            return 0
        configured = [entry for entry in self._configured_entries if entry.model == model]
        if len({entry.base_url for entry in configured}) >= replica_count:
            others = [entry for entry in self.entries if entry.model != model]
            self.entries = others + configured[:replica_count]
            self._selection_cursor[model] = 0
            return replica_count
        template = matching[0]
        base_backend_id = re.sub(r"(?:-replica-\d+)+$", "", template.backend_id)
        others = [entry for entry in self.entries if entry.model != model]
        replicas = []
        for index in range(replica_count):
            agent = BackendResilienceAgent(
                self._settings.backend_max_retries,
                self._settings.backend_retry_backoff_seconds,
                self._settings.backend_circuit_failure_threshold,
                self._settings.backend_circuit_recovery_seconds,
            )
            replicas.append(BackendEntry(
                backend_id=f"{base_backend_id}-replica-{index + 1}",
                provider=template.provider,
                base_url=template.base_url,
                model=template.model,
                adapter=template.adapter,
                resilience=agent,
                max_concurrency=1,
                healthy=template.healthy,
            ))
        self.entries = others + replicas
        self._selection_cursor[model] = 0
        return len(replicas)

    async def generate(self, payload, request_id: str, on_event):
        entry = self.select(payload.model)
        entry.active += 1
        try:
            await on_event("backend_selected", {"backend_id": entry.backend_id, "container_id": entry.container_id, "model": entry.model, "message": f"Dispatched to {entry.backend_id}"})
            async def event(name: str, data: dict) -> None:
                await on_event(name, {"backend_id": entry.backend_id, "container_id": entry.container_id, **data})
            return await entry.resilience.execute(lambda: entry.adapter.generate(payload, request_id), event)
        except (RealInferenceError, BackendUnavailableError):
            entry.healthy = entry.resilience.state != "open"
            raise
        finally:
            entry.active -= 1

    async def health_check(self) -> bool:
        healthy = False
        for entry in self.entries:
            try:
                await entry.adapter.health_check()
                entry.healthy = True
                healthy = True
            except Exception:
                entry.healthy = False
        return healthy

    def snapshot(self) -> list[dict]:
        return [{"backend_id": e.backend_id, "provider": e.provider, "base_url": e.base_url, "served_models": [e.model], "status": "healthy" if e.healthy else "unhealthy", "lifecycle_state": e.lifecycle_state, "temporary": e.temporary, "container_id": e.container_id, "active_requests": e.active, "max_concurrency": e.max_concurrency, "fault_tolerance": e.resilience.snapshot()} for e in self.entries]
