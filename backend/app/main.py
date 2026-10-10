from contextlib import asynccontextmanager
import logging
from uuid import uuid4

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.experiments import router as experiments_router
from app.api.backends import router as backends_router
from app.api.scheduler_config import router as scheduler_router
from app.api.scaling import router as scaling_router
from app.api.reports import router as reports_router
from app.api.models import router as models_router
from app.api.requests import router as requests_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.inference.mock_adapter import MockInferenceAdapter
from app.inference.openai_compatible import OpenAICompatibleAdapter
from app.inference.ollama_adapter import OllamaAdapter
from app.gateway.service import InferenceGateway
from app.scaling.controller import ScalingController
from app.scaling.worker_manager import WorkerManager
from app.storage.database import Repository
from app.backends.health_monitor import HealthMonitor
from app.backends.resilience import BackendResilienceAgent
from app.backends.pool import BackendPool
from app.api.dev_faults import router as dev_faults_router
from app.api.fault_recovery import router as fault_recovery_router
from app.artifacts.store import ArtifactStore
from app.experiments.llm_planner import ExcelWorkloadPlanner
from app.tokenization.token_predictor import TokenPredictor


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    app.state.settings = settings
    app.state.artifacts = ArtifactStore(settings.artifacts_root)
    app.state.mock_adapter = MockInferenceAdapter(settings)
    app.state.real_adapter = None
    if settings.inference_mode in {"real", "hybrid"}:
        app.state.real_adapter = OllamaAdapter(settings, model_id=settings.backend_ollama_model, component="backend") if settings.llm_provider == "ollama" else OpenAICompatibleAdapter(settings)
    app.state.backend_pool = BackendPool(settings) if settings.inference_mode in {"real", "hybrid"} else None
    app.state.repository = Repository(settings.database_url)
    ollama_url = settings.ollama_base_url or settings.llm_base_url or "http://127.0.0.1:11434"
    app.state.token_predictor = TokenPredictor(
        base_url=ollama_url,
        model=settings.token_predictor_model,
        timeout_seconds=settings.token_predictor_timeout_seconds,
        enabled=settings.token_predictor_enabled,
    )
    app.state.workload_planner = (
        ExcelWorkloadPlanner(settings.workload_excel_path, app.state.repository, token_predictor=app.state.token_predictor)
        if app.state.backend_pool
        else None
    )
    app.state.experiments = app.state.repository.load_experiments()
    for experiment in app.state.experiments.values():
        if experiment.get("status") in {"running", "planning"}:
            experiment["status"] = "failed"
            experiment["error"] = "Gateway restarted while this experiment was running; submit a new run"
            app.state.repository.save_experiment(experiment)
    app.state.scaling = ScalingController(settings.scaling_min_replicas, settings.scaling_max_replicas, settings.scaling_dry_run, settings.scaling_queue_per_replica)
    app.state.resilience = BackendResilienceAgent(settings.backend_max_retries, settings.backend_retry_backoff_seconds, settings.backend_circuit_failure_threshold, settings.backend_circuit_recovery_seconds)
    app.state.gateway = InferenceGateway(app)
    app.state.worker_manager = WorkerManager(app)
    app.state.health_monitor = HealthMonitor(app, settings.health_check_interval_seconds)
    app.state.gateway.start()
    app.state.worker_manager.start()
    app.state.health_monitor.start()
    yield
    await app.state.worker_manager.close()
    await app.state.gateway.close()
    await app.state.health_monitor.close()
    app.state.repository.close()


app = FastAPI(
    title="Token-Aware Inference Gateway",
    version="0.2.0-phase2",
    description="Gateway with mock mode and configurable OpenAI-compatible real inference.",
    lifespan=lifespan,
)

settings_for_middleware = get_settings()
origins = [item.strip() for item in settings_for_middleware.cors_origins.split(",") if item.strip()]
if origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type", "X-API-Key", "X-Request-ID", "Last-Event-ID"],
    )


@app.middleware("http")
async def security_limits(request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    length = request.headers.get("content-length")
    if length:
        try:
            too_large = int(length) > get_settings().max_request_bytes
        except ValueError:
            return JSONResponse({"detail": "invalid Content-Length header", "request_id": request_id}, status_code=400)
        if too_large:
            return JSONResponse({"detail": "request body exceeds configured limit", "request_id": request_id}, status_code=413)
    protected = ("/api/experiments", "/api/scheduler", "/api/scaling", "/api/dev/", "/api/fault-recovery")
    key = get_settings().management_api_key
    if key and request.url.path.startswith(protected) and request.headers.get("x-api-key") != key:
        return JSONResponse({"detail": "management API authentication required", "request_id": request_id}, status_code=401)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    logging.getLogger("gateway.request").info("request_id=%s method=%s path=%s status=%s", request_id, request.method, request.url.path, response.status_code)
    return response
app.include_router(health_router)
app.include_router(requests_router)
app.include_router(models_router)
app.include_router(experiments_router)
app.include_router(backends_router)
app.include_router(scheduler_router)
app.include_router(scaling_router)
app.include_router(reports_router)
app.include_router(dev_faults_router)
app.include_router(fault_recovery_router)


@app.get("/api/system/status", tags=["system"])
async def system_status() -> dict:
    settings = get_settings()
    engine = app.state.gateway.scheduler
    return {
        "service": "gateway",
        "mode": settings.inference_mode,
        "phase": 2,
        "queue_depth": len(engine.pending),
        "active_requests": len(engine.active),
        "scheduler_policy": engine.policy,
        "backend_healthy": app.state.health_monitor.healthy,
        "fault_tolerance": [item["fault_tolerance"] for item in app.state.backend_pool.snapshot()] if app.state.backend_pool else [app.state.resilience.snapshot()],
        "scaling": {**app.state.scaling.snapshot(), **app.state.worker_manager.snapshot()},
        "metrics": app.state.gateway.metrics.snapshot(),
    }
