import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.models.requests import InferenceRequest
from app.metrics.collector import MetricsCollector, RequestMetric
from app.experiments.workload_generator import PROFILES, generate

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


class ExperimentCreate(BaseModel):
    name: str = Field(default="experiment", min_length=1, max_length=120)
    scheduler_policy: str = Field(default="fifo", pattern="^(fifo|token_aware)$")
    requests: list[InferenceRequest] = Field(default_factory=list, max_length=500)
    workload_profile: str | None = None
    request_count: int = Field(default=20, ge=1, le=50_000)
    model: str = "mock-echo-1"
    random_seed: int = 42


class PairedExperimentCreate(BaseModel):
    name: str = Field(default="paired benchmark", min_length=1, max_length=120)
    workload_profile: str = "short_interactive"
    request_count: int = Field(default=150, ge=3, le=150)
    backend_count: int = Field(default=4, ge=1, le=32)
    max_requests_per_backend: int = Field(default=1, ge=1, le=32)
    model: str


class PairedExperimentStart(BaseModel):
    fifo_experiment_id: str
    token_aware_experiment_id: str


def register_experiment(request: Request, name: str, policy: str, profile: str | None, requests: list[InferenceRequest]) -> dict:
    experiment_id = str(uuid4())
    result = {"experiment_id": experiment_id, "name": name, "status": "created", "scheduler_policy": policy, "created_at": datetime.now(UTC).isoformat(), "request_count": len(requests), "workload_profile": profile, "requests": [item.model_dump() for item in requests]}
    registry(request)[experiment_id] = result
    request.app.state.repository.save_experiment(result)
    return result


def registry(request: Request) -> dict:
    return request.app.state.experiments


def public(experiment: dict) -> dict:
    return {key: value for key, value in experiment.items() if not key.startswith("_")}


def persisted_metrics(request: Request, experiment_id: str) -> dict:
    collector = MetricsCollector(request.app.state.settings.starvation_threshold_ms, request.app.state.settings.starvation_slowdown_limit, request.app.state.settings.scheduler_max_bypass)
    for row in request.app.state.repository.request_records(experiment_id):
        metric = row["metrics"]
        if row["status"] != "completed" or "total_latency_ms" not in metric:
            continue
        collector.record(experiment_id, RequestMetric(
            queue_wait_ms=float(metric.get("queue_wait_ms") or 0),
            total_latency_ms=float(metric["total_latency_ms"]),
            inference_latency_ms=float(metric.get("inference_latency_ms") or 0),
            prediction_latency_ms=float(metric.get("prediction_latency_ms") or 0),
            ttft_ms=float(metric["ttft_ms"]) if metric.get("ttft_ms") is not None else None,
            input_tokens=int(metric.get("input_tokens") or 0),
            output_tokens=int(metric.get("actual_output_tokens") or 0),
            predicted_output_tokens=int(metric.get("predicted_output_tokens") or 0),
            overdue_at_dispatch=bool(metric.get("overdue_at_dispatch", False)),
            bypassed=int(metric.get("bypassed") or 0),
        ))
    return collector.snapshot(experiment_id)


@router.post("")
async def create_experiment(payload: ExperimentCreate, request: Request) -> dict:
    if payload.workload_profile:
        if payload.requests:
            raise HTTPException(status_code=422, detail="provide requests or workload_profile, not both")
        try:
            payload.requests = generate(payload.workload_profile, payload.request_count, payload.model, payload.random_seed)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    experiment_id = str(uuid4())
    result = {
        "experiment_id": experiment_id,
        "name": payload.name,
        "status": "created",
        "scheduler_policy": payload.scheduler_policy,
        "created_at": datetime.now(UTC).isoformat(),
        "request_count": len(payload.requests),
        "workload_profile": payload.workload_profile,
        "random_seed": payload.random_seed,
        "requests": [item.model_dump() for item in payload.requests],
    }
    registry(request)[experiment_id] = result
    request.app.state.repository.save_experiment(result)
    return public(result)


@router.post("/paired")
async def create_paired_experiments(payload: PairedExperimentCreate, request: Request) -> dict:
    if not request.app.state.workload_planner:
        raise HTTPException(status_code=503, detail="LLM workload planning requires a real backend")
    if payload.workload_profile not in PROFILES:
        raise HTTPException(status_code=422, detail="unknown workload profile")
    pool = request.app.state.backend_pool
    manager = request.app.state.worker_manager
    if not pool.supports_model(payload.model):
        raise HTTPException(status_code=422, detail=f"no backend is configured for model '{payload.model}'")
    if manager.enabled:
        replicas = min(payload.backend_count, request.app.state.scaling.state.max_replicas)
    else:
        replicas = pool.set_model_replicas(payload.model, payload.backend_count)
        if not replicas:
            raise HTTPException(status_code=409, detail="configured backends are currently busy and cannot be resized")
    fifo = register_experiment(request, f"{payload.name} — FIFO", "fifo", payload.workload_profile, [])
    token = register_experiment(request, f"{payload.name} — D07", "token_aware", payload.workload_profile, [])
    pair_id = str(uuid4())
    fifo.update({"pair_id": pair_id, "pair_role": "fifo", "paired_experiment_id": token["experiment_id"]})
    token.update({"pair_id": pair_id, "pair_role": "token_aware", "paired_experiment_id": fifo["experiment_id"]})
    fifo["backend_count"] = token["backend_count"] = replicas
    fifo["max_requests_per_backend"] = token["max_requests_per_backend"] = 1
    fifo["status"] = token["status"] = "planning"
    fifo["request_count"] = token["request_count"] = payload.request_count
    request.app.state.repository.save_experiment(fifo)
    request.app.state.repository.save_experiment(token)

    async def plan_and_run() -> None:
        try:
            await request.app.state.gateway.events.publish(fifo["experiment_id"], "experiment_planning", {"message": "Loading benchmark questions from Excel and predicting output tokens deterministically"})
            requests = await request.app.state.workload_planner.generate(payload.workload_profile, payload.request_count, payload.model)
            workload_path = request.app.state.artifacts.write_workload_excel(pair_id, requests)
            serialized = [item.model_dump() for item in requests]
            for experiment in (fifo, token):
                experiment["requests"] = serialized
                experiment["request_count"] = len(requests)
                experiment["status"] = "created"
                experiment["input_source"] = "excel"
                sources = sorted({item.metadata.get("output_prediction_source", "deterministic_heuristic") for item in requests})
                experiment["output_prediction_source"] = ",".join(sources)
                experiment["workload_excel"] = workload_path
                experiment["result_excel"] = str(request.app.state.artifacts.results / f"{experiment['experiment_id']}.xlsx")
                experiment["benchmark_capacity_prepared"] = replicas
                experiment["benchmark_order"] = ["fifo", "token_aware"]
                request.app.state.repository.save_experiment(experiment)
            # Prepare the same healthy proxy capacity before measurement. This
            # removes Docker cold-start time from FIFO while Token-Aware would
            # otherwise inherit already-warm workers from the first run.
            await request.app.state.worker_manager.ensure_capacity(replicas, 0)
            await start_experiment(fifo["experiment_id"], request)
            await fifo["_task"]
            await start_experiment(token["experiment_id"], request)
        except Exception as exc:
            for experiment in (fifo, token):
                experiment["status"] = "failed"
                experiment["error"] = str(exc)
                request.app.state.repository.save_experiment(experiment)
                await request.app.state.gateway.events.publish(experiment["experiment_id"], "experiment_failed", {"error": str(exc)})

    asyncio.create_task(plan_and_run())
    return {"fifo_experiment_id": fifo["experiment_id"], "token_aware_experiment_id": token["experiment_id"], "active_experiment_id": fifo["experiment_id"], "status": "planning", "request_count": payload.request_count, "pair_id": pair_id}


@router.post("/paired/start")
async def start_paired_experiments(payload: PairedExperimentStart, request: Request) -> dict:
    async def run_pair() -> None:
        await start_experiment(payload.fifo_experiment_id, request)
        fifo = registry(request)[payload.fifo_experiment_id]
        await fifo["_task"]
        await start_experiment(payload.token_aware_experiment_id, request)

    asyncio.create_task(run_pair())
    return {"status": "running", "fifo_experiment_id": payload.fifo_experiment_id, "token_aware_experiment_id": payload.token_aware_experiment_id, "active_experiment_id": payload.fifo_experiment_id}


@router.get("/profiles")
async def workload_profiles() -> dict:
    return {"data": sorted(PROFILES)}


@router.get("")
async def list_experiments(request: Request) -> dict:
    return {"data": [public(item) for item in registry(request).values()]}


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str, request: Request) -> dict:
    result = registry(request).get(experiment_id)
    if not result:
        raise HTTPException(status_code=404, detail="experiment not found")
    snapshot = public(result)
    statuses = [item for item in request.app.state.gateway.requests.values() if item.experiment_id == experiment_id]
    persisted_counts = request.app.state.repository.request_counts(experiment_id)
    metrics = request.app.state.gateway.metrics.snapshot(experiment_id)
    if not metrics["samples"]:
        metrics = persisted_metrics(request, experiment_id)
    backends = request.app.state.backend_pool.snapshot() if request.app.state.backend_pool else []
    started_at = snapshot.get("started_at")
    ended_at = snapshot.get("completed_at") or snapshot.get("failed_at")
    elapsed = max(0.001, ((datetime.fromisoformat(ended_at) if ended_at else datetime.now(UTC)) - datetime.fromisoformat(started_at)).total_seconds()) if started_at else 0
    snapshot.update({
        "queued_requests": sum(item.status == "queued" for item in statuses) if statuses else persisted_counts["queued"],
        "completed_requests": sum(item.status == "completed" for item in statuses) if statuses else persisted_counts["completed"],
        "failed_requests": sum(item.status == "failed" for item in statuses) if statuses else persisted_counts["failed"],
        "cancelled_requests": sum(item.status == "cancelled" for item in statuses) if statuses else persisted_counts["cancelled"],
        "active_backends": sum(item["status"] == "healthy" for item in backends) if backends else 1,
        "avg_backend_utilization_pct": (100 * sum(item["active_requests"] for item in backends) / max(1, sum(item["max_concurrency"] for item in backends))) if backends else 0,
        "elapsed_seconds": int(elapsed),
        "current_throughput_rps": metrics["completed"] / elapsed if elapsed else 0,
        "current_p95_latency_ms": metrics["completion_latency_ms"]["p95"] or 0,
        "current_avg_latency_ms": metrics["completion_latency_ms"]["avg"] or 0,
        "median_latency_ms": metrics["completion_latency_ms"]["p50"] or 0,
        "p99_latency_ms": metrics["completion_latency_ms"]["p99"] or 0,
        "avg_ttft_ms": metrics["ttft_ms"]["avg"] or 0,
        "tokens_per_second": metrics["output_tokens"] / elapsed if elapsed else 0,
        "starvation_rate_pct": metrics["starvation_rate_pct"],
        "starvation_threshold_ms": metrics["starvation_threshold_ms"],
        "average_queue_wait_ms": metrics["queue_wait_average_ms"] or 0,
        "p95_queue_wait_ms": metrics["queue_wait_ms"]["p95"] or 0,
        "max_queue_wait_ms": metrics["queue_wait_max_ms"] or 0,
        "over_300ms_rate_pct": metrics["over_300ms_rate_pct"],
        "overdue_waiting": request.app.state.gateway.scheduler.overdue_waiting(),
        "overdue_dispatched": metrics["overdue_dispatched"],
        "max_bypass": metrics["max_bypass"],
        "fairness_starvation_rate_pct": metrics["fairness_starvation_rate_pct"],
        "jain_fairness_on_slowdown": metrics["jain_fairness_on_slowdown"],
        "queue_wait_distribution_pct": metrics["queue_wait_distribution_pct"],
        "prediction_error": metrics["prediction_error"],
        "avg_prediction_latency_ms": metrics["prediction_latency_ms"]["avg"] or 0,
        "avg_inference_latency_ms": metrics["inference_latency_ms"]["avg"] or 0,
        "metric_samples": metrics["samples"],
        "recent_requests": [item.model_dump() for item in statuses[-100:]],
    })
    if snapshot["status"] == "completed":
        snapshot["completed_requests"] = min(snapshot["completed_requests"], snapshot.get("request_count", snapshot["completed_requests"]))
        snapshot["queued_requests"] = 0
        snapshot.pop("error", None)
    return snapshot


@router.post("/{experiment_id}/start")
async def start_experiment(experiment_id: str, request: Request) -> dict:
    experiment = registry(request).get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="experiment not found")
    if experiment["status"] not in {"created", "failed"}:
        raise HTTPException(status_code=409, detail="experiment has already started")
    experiment["status"] = "running"
    experiment["started_at"] = datetime.now(UTC).isoformat()
    experiment.pop("error", None)
    request.app.state.repository.save_experiment(experiment)
    gateway = request.app.state.gateway
    await gateway.events.publish(experiment_id, "experiment_started", {"experiment_id": experiment_id})

    async def run() -> None:
        try:
            jobs = []
            for raw in experiment["requests"]:
                payload = InferenceRequest(**raw).model_copy(
                    update={"experiment_id": experiment_id, "scheduler_policy": experiment["scheduler_policy"]}
                )
                jobs.append(asyncio.create_task(gateway.submit(payload)))
            if jobs:
                await asyncio.gather(*jobs)
            experiment["status"] = "completed"
            experiment["completed_at"] = datetime.now(UTC).isoformat()
            request.app.state.repository.save_experiment(experiment)
            await gateway.events.publish(experiment_id, "experiment_completed", {"experiment_id": experiment_id})
        except Exception as exc:
            experiment["status"] = "failed"
            experiment["error"] = str(exc)
            experiment["failed_at"] = datetime.now(UTC).isoformat()
            request.app.state.repository.save_experiment(experiment)
            await gateway.events.publish(experiment_id, "experiment_failed", {"error": str(exc)})

    experiment["_task"] = asyncio.create_task(run())
    return public(experiment)


@router.post("/{experiment_id}/cancel")
async def cancel_experiment(experiment_id: str, request: Request) -> dict:
    experiment = registry(request).get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="experiment not found")
    task = experiment.get("_task")
    if task and not task.done():
        task.cancel()
    experiment["status"] = "cancelled"
    request.app.state.repository.save_experiment(experiment)
    return public(experiment)


@router.get("/{experiment_id}/events")
async def experiment_events(experiment_id: str, request: Request):
    if experiment_id not in registry(request):
        raise HTTPException(status_code=404, detail="experiment not found")
    last = request.headers.get("last-event-id")
    try:
        last_id = int(last) if last else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Last-Event-ID must be an integer")
    return StreamingResponse(request.app.state.gateway.events.subscribe(experiment_id, last_id), media_type="text/event-stream")


@router.get("/{experiment_id}/metrics")
async def experiment_metrics(experiment_id: str, request: Request) -> dict:
    if experiment_id not in registry(request):
        raise HTTPException(status_code=404, detail="experiment not found")
    return request.app.state.gateway.metrics.snapshot(experiment_id)


@router.get("/{experiment_id}/report")
async def experiment_report(experiment_id: str, request: Request) -> dict:
    experiment = registry(request).get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="experiment not found")
    return {"experiment": public(experiment), "metrics": request.app.state.gateway.metrics.snapshot(experiment_id), "measurement_type": "mock" if request.app.state.settings.inference_mode == "mock" else "real"}
