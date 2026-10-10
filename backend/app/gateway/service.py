import asyncio
import time
from datetime import UTC, datetime
from uuid import uuid4

from app.events.publisher import EventPublisher
from app.inference.mock_adapter import MockBackendError
from app.inference.openai_compatible import RealInferenceError
from app.metrics.collector import MetricsCollector, RequestMetric
from app.models.requests import InferenceRequest, InferenceResponse, RequestStatus
from app.scheduler.engine import QueuedRequest, SchedulerEngine
from app.tokenization.token_counter import TokenCounter


class InferenceGateway:
    def __init__(self, app) -> None:
        self.app = app
        self.requests: dict[str, RequestStatus] = {}
        self.events = EventPublisher()
        self.metrics = MetricsCollector(
            getattr(app.state.settings, "starvation_threshold_ms", 2000),
            getattr(app.state.settings, "starvation_slowdown_limit", 3.0),
            getattr(app.state.settings, "scheduler_max_bypass", 8),
        )
        self.tokens = TokenCounter(app.state.settings.llm_tokenizer_id)
        settings = app.state.settings
        def dispatch_capacity(queued: int, active: int) -> int:
            planned = app.state.scaling.capacity(queued, active)
            # Dispatch may use only replicas activated by the planner and may
            # never exceed the physical healthy-worker pool.
            if app.state.backend_pool:
                return max(0, min(planned, app.state.backend_pool.capacity()))
            return max(1, planned)

        self.scheduler = SchedulerEngine(
            self._execute,
            policy=settings.scheduler_policy,
            max_queue=settings.scheduler_max_queue,
            max_wait_seconds=settings.scheduler_max_wait_seconds,
            aging_weight=settings.scheduler_aging_weight,
            max_bypass=getattr(settings, "scheduler_max_bypass", 8),
            capacity=dispatch_capacity,
        )

    def start(self) -> None:
        self.scheduler.start()

    async def close(self) -> None:
        await self.scheduler.close()

    async def _input_estimate(self, payload: InferenceRequest):
        text = payload.prompt or " ".join(message.content for message in payload.messages or [])
        return await self.tokens.count(text)

    async def submit(self, payload: InferenceRequest) -> InferenceResponse:
        received_at = time.monotonic()
        received_at_utc = datetime.now(UTC).isoformat()
        output_prediction_source = payload.metadata.get("output_prediction_source")
        if payload.expected_output_tokens is None:
            predictor = getattr(self.app.state, "token_predictor", None)
            if predictor and getattr(self.app.state.settings, "token_predictor_enabled", True):
                preview_text = payload.prompt or " ".join(message.content for message in payload.messages or [])
                pred = await predictor.predict(preview_text)
                payload = payload.model_copy(update={"expected_output_tokens": pred.predicted_tokens})
                output_prediction_source = pred.source
            else:
                payload = payload.model_copy(update={"expected_output_tokens": self.app.state.settings.scheduler_default_output_tokens})
                output_prediction_source = output_prediction_source or "default_constant"
        elif not output_prediction_source:
            output_prediction_source = "user_provided"
        request_id = str(uuid4())
        future: asyncio.Future[InferenceResponse] = asyncio.get_running_loop().create_future()
        preview = payload.prompt or " ".join(message.content for message in payload.messages or [])
        self.requests[request_id] = RequestStatus(
            request_id=request_id,
            status="queued",
            model=payload.model,
            experiment_id=payload.experiment_id,
            request_kind="prompt" if payload.prompt else "chat",
            prompt_preview=preview[:160],
            priority=payload.priority,
            output_prediction_source=output_prediction_source,
        )
        self.app.state.repository.save_request(request_id, payload.experiment_id, payload.model, "queued", payload.metadata)
        await self.events.publish(payload.experiment_id, "request_accepted", {"request_id": request_id, "model": payload.model})
        await self.events.publish(payload.experiment_id, "request_queued", {"request_id": request_id, "queue_depth": len(self.scheduler.pending) + 1})
        policy = payload.scheduler_policy
        if policy:
            self.scheduler.policy = policy
        prediction_started = time.monotonic()
        token_count = await self._input_estimate(payload)
        prediction_latency_ms = (time.monotonic() - prediction_started) * 1000 + float(payload.metadata.get("prediction_latency_ms", 0))
        request_status = self.requests[request_id]
        request_status.input_tokens = token_count.count
        request_status.estimated_output_tokens = payload.expected_output_tokens or payload.max_output_tokens
        request_status.estimated_cost = round(request_status.input_tokens + self.app.state.settings.scheduler_output_token_weight * request_status.estimated_output_tokens)
        request_status.scheduling_score = float(request_status.estimated_cost)
        request_status.prediction_latency_ms = prediction_latency_ms
        request_status.output_prediction_source = output_prediction_source
        lifecycle = {
            **payload.metadata,
            "scheduler_policy": payload.scheduler_policy or self.scheduler.policy,
            "received_monotonic": received_at,
            "enqueued_monotonic": time.monotonic(),
            "received_at": received_at_utc,
            "enqueued_at": datetime.now(UTC).isoformat(),
            "estimated_input_tokens": request_status.input_tokens,
            "input_token_method": token_count.method,
            "predicted_output_tokens": request_status.estimated_output_tokens,
            "output_prediction_source": output_prediction_source,
            "estimated_cost": request_status.estimated_cost,
            "prediction_latency_ms": prediction_latency_ms,
        }
        self.app.state.repository.save_request(request_id, payload.experiment_id, payload.model, "queued", lifecycle)
        self.app.state.artifacts.write_input(request_id, payload)
        await self.events.publish(payload.experiment_id, "request_calculated", {**request_status.model_dump(exclude={"response"}), "message": "Token cost and initial scheduling score calculated"})
        context_limit = self.app.state.settings.llm_max_context_tokens
        if context_limit and token_count.count + payload.max_output_tokens > context_limit:
            self.requests.pop(request_id, None)
            raise ValueError("input and requested output tokens exceed the configured model context limit")
        item = QueuedRequest(
            request_id, payload, time.monotonic(), token_count.count, future,
            received_at=received_at,
            prediction_latency_ms=prediction_latency_ms,
            output_token_weight=self.app.state.settings.scheduler_output_token_weight,
        )
        try:
            return await self.scheduler.submit(item)
        except asyncio.CancelledError:
            self.requests[request_id].status = "cancelled"
            self.metrics.cancelled += 1
            await self.events.publish(payload.experiment_id, "request_cancelled", {"request_id": request_id})
            raise
        except Exception as exc:
            status = self.requests[request_id]
            status.status = "failed"
            status.error = str(exc)
            self.metrics.failed += 1
            self.app.state.repository.save_request(
                request_id, payload.experiment_id, payload.model, "failed",
                metrics={"error": str(exc), "queue_wait_ms": status.queue_wait_ms, "assigned_backend": status.assigned_backend},
            )
            await self.events.publish(payload.experiment_id, "request_failed", {"request_id": request_id, "error": str(exc)})
            raise

    async def _execute(self, item: QueuedRequest) -> InferenceResponse:
        started = time.monotonic()
        status = self.requests[item.request_id]
        status.status = "running"
        self.app.state.repository.save_request(item.request_id, item.payload.experiment_id, item.payload.model, "running", metrics={"processing_started_at": datetime.now(UTC).isoformat()})
        status.queue_wait_ms = (started - item.created_at) * 1000
        status.scheduling_score = item.estimated_tokens - self.scheduler.aging_weight * (started - item.created_at)
        await self.events.publish(item.payload.experiment_id, "request_dispatched", {**status.model_dump(exclude={"response"}), "message": "Request dispatched by lowest scheduling score"})
        settings = self.app.state.settings
        async def publish(event: str, data: dict) -> None:
            if data.get("backend_id"):
                status.assigned_backend = data["backend_id"]
            if data.get("container_id"):
                status.assigned_container_id = data["container_id"]
            await self.events.publish(item.payload.experiment_id, event, {"request_id": item.request_id, **data})

        if settings.inference_mode == "real" or (settings.inference_mode == "hybrid" and item.payload.model != "mock-echo-1"):
            result = await self.app.state.backend_pool.generate(item.payload, item.request_id, publish)
        else:
            result = await self.app.state.resilience.execute(lambda: self.app.state.mock_adapter.generate(item.payload, item.request_id), publish)
        completed_at = time.monotonic()
        elapsed = (completed_at - started) * 1000
        total_latency_ms = (completed_at - (item.received_at or item.created_at)) * 1000
        status.status = "completed"
        status.response = result
        status.output_preview = result.output[:240]
        status.input_tokens = result.input_tokens or status.input_tokens
        status.inference_latency_ms = elapsed
        status.total_latency_ms = total_latency_ms
        status.actual_output_tokens = result.output_tokens
        status.prediction_absolute_error = abs(result.output_tokens - status.estimated_output_tokens)
        status.prediction_relative_error_pct = (status.prediction_absolute_error / result.output_tokens * 100) if result.output_tokens > 0 else None
        ttft_ms = ((started - (item.received_at or item.created_at)) * 1000 + result.ttft_ms) if result.ttft_ms is not None else None
        status.ttft_ms = ttft_ms
        self.app.state.artifacts.write_output(item.request_id, item.payload.experiment_id, result)
        self.app.state.artifacts.append_result_excel(item.request_id, item.payload.experiment_id, item.payload, result, status.assigned_backend, total_latency_ms)
        self.app.state.repository.save_request(item.request_id, item.payload.experiment_id, item.payload.model, "completed", metrics={
            "queue_wait_ms": status.queue_wait_ms,
            "prediction_latency_ms": status.prediction_latency_ms,
            "inference_latency_ms": elapsed,
            "total_latency_ms": total_latency_ms,
            "ttft_ms": ttft_ms,
            "input_tokens": status.input_tokens,
            "input_token_method": result.input_token_method,
            "predicted_output_tokens": status.estimated_output_tokens,
            "output_prediction_source": status.output_prediction_source or item.payload.metadata.get("output_prediction_source"),
            "actual_output_tokens": result.output_tokens,
            "output_token_method": result.output_token_method,
            "prediction_absolute_error": status.prediction_absolute_error,
            "prediction_relative_error_pct": status.prediction_relative_error_pct,
            "assigned_backend": status.assigned_backend,
            "assigned_container_id": status.assigned_container_id,
            "effective_score": status.scheduling_score,
            "overdue_at_dispatch": item.overdue_at_dispatch,
            "bypassed": item.bypassed,
            "selection_reason": item.selection_reason,
            "simulated": result.simulated,
            "completed_at": datetime.now(UTC).isoformat(),
        })
        self.metrics.record(item.payload.experiment_id, RequestMetric(
            status.queue_wait_ms or 0, total_latency_ms, elapsed, status.prediction_latency_ms,
            ttft_ms, status.input_tokens, result.output_tokens, status.estimated_output_tokens, item.overdue_at_dispatch, item.bypassed,
        ))
        await self.events.publish(item.payload.experiment_id, "first_token", {"request_id": item.request_id, "ttft_ms": ttft_ms, "message": "First output token received"})
        await self.events.publish(item.payload.experiment_id, "request_completed", {**status.model_dump(exclude={"response"}), "output_tokens": result.output_tokens, "completion_latency_ms": total_latency_ms, "inference_latency_ms": elapsed, "ttft_ms": ttft_ms, "message": "Request completed"})
        return result

    def cancel(self, request_id: str) -> bool:
        return self.scheduler.cancel(request_id)

    async def stream(self, payload: InferenceRequest):
        request_id = str(uuid4())
        self.requests[request_id] = RequestStatus(request_id=request_id, status="running", model=payload.model, experiment_id=payload.experiment_id)
        settings = self.app.state.settings
        adapter = self.app.state.real_adapter if settings.inference_mode == "real" else self.app.state.mock_adapter
        backend_model = settings.backend_ollama_model if settings.llm_provider == "ollama" else settings.llm_model_id
        if settings.inference_mode == "hybrid" and payload.model == backend_model:
            adapter = self.app.state.real_adapter
        yield {"type": "request_started", "request_id": request_id}
        output = ""
        try:
            async for item in adapter.generate_stream(payload, request_id) if adapter is self.app.state.mock_adapter else adapter.generate_stream(payload):
                if item["type"] == "token":
                    output += item["content"]
                yield item
            self.requests[request_id].status = "completed"
            yield {"type": "request_completed", "request_id": request_id}
        except Exception as exc:
            self.requests[request_id].status = "failed"
            self.requests[request_id].error = str(exc)
            yield {"type": "request_error", "request_id": request_id, "error": str(exc)}
