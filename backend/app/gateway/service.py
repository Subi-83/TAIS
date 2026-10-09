import asyncio
import time
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
        self.metrics = MetricsCollector()
        self.tokens = TokenCounter(app.state.settings.llm_tokenizer_id)
        settings = app.state.settings
        self.scheduler = SchedulerEngine(
            self._execute,
            policy=settings.scheduler_policy,
            max_queue=settings.scheduler_max_queue,
            max_wait_seconds=settings.scheduler_max_wait_seconds,
        )

    def start(self) -> None:
        self.scheduler.start()

    async def close(self) -> None:
        await self.scheduler.close()

    async def _input_estimate(self, payload: InferenceRequest):
        text = payload.prompt or " ".join(message.content for message in payload.messages or [])
        return await self.tokens.count(text)

    async def submit(self, payload: InferenceRequest) -> InferenceResponse:
        request_id = str(uuid4())
        future: asyncio.Future[InferenceResponse] = asyncio.get_running_loop().create_future()
        self.requests[request_id] = RequestStatus(request_id=request_id, status="queued", model=payload.model, experiment_id=payload.experiment_id)
        self.app.state.repository.save_request(request_id, payload.experiment_id, payload.model, "queued", payload.metadata)
        await self.events.publish(payload.experiment_id, "request_accepted", {"request_id": request_id, "model": payload.model})
        await self.events.publish(payload.experiment_id, "request_queued", {"request_id": request_id, "queue_depth": len(self.scheduler.pending) + 1})
        policy = payload.scheduler_policy
        if policy:
            self.scheduler.policy = policy
        token_count = await self._input_estimate(payload)
        context_limit = self.app.state.settings.llm_max_context_tokens
        if context_limit and token_count.count + payload.max_output_tokens > context_limit:
            self.requests.pop(request_id, None)
            raise ValueError("input and requested output tokens exceed the configured model context limit")
        item = QueuedRequest(request_id, payload, time.monotonic(), token_count.count, future)
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
            await self.events.publish(payload.experiment_id, "request_failed", {"request_id": request_id, "error": str(exc)})
            raise

    async def _execute(self, item: QueuedRequest) -> InferenceResponse:
        started = time.monotonic()
        status = self.requests[item.request_id]
        status.status = "running"
        self.app.state.repository.save_request(item.request_id, item.payload.experiment_id, item.payload.model, "running")
        status.queue_wait_ms = (started - item.created_at) * 1000
        await self.events.publish(item.payload.experiment_id, "request_dispatched", {"request_id": item.request_id, "queue_wait_ms": status.queue_wait_ms})
        settings = self.app.state.settings
        if settings.inference_mode == "real":
            result = await self.app.state.real_adapter.generate(item.payload, item.request_id)
        elif settings.inference_mode == "hybrid" and item.payload.model == settings.llm_model_id:
            result = await self.app.state.real_adapter.generate(item.payload, item.request_id)
        else:
            result = await self.app.state.mock_adapter.generate(item.payload, item.request_id)
        elapsed = (time.monotonic() - started) * 1000
        status.status = "completed"
        status.response = result
        self.app.state.repository.save_request(item.request_id, item.payload.experiment_id, item.payload.model, "completed", metrics={"queue_wait_ms": status.queue_wait_ms, "output_tokens": result.output_tokens, "simulated": result.simulated})
        self.metrics.record(item.payload.experiment_id, RequestMetric(status.queue_wait_ms or 0, elapsed, elapsed, result.output_tokens))
        await self.events.publish(item.payload.experiment_id, "first_token", {"request_id": item.request_id, "ttft_ms": elapsed})
        await self.events.publish(item.payload.experiment_id, "request_completed", {"request_id": item.request_id, "completion_latency_ms": elapsed})
        return result

    def cancel(self, request_id: str) -> bool:
        return self.scheduler.cancel(request_id)

    async def stream(self, payload: InferenceRequest):
        request_id = str(uuid4())
        self.requests[request_id] = RequestStatus(request_id=request_id, status="running", model=payload.model, experiment_id=payload.experiment_id)
        settings = self.app.state.settings
        adapter = self.app.state.real_adapter if settings.inference_mode == "real" else self.app.state.mock_adapter
        if settings.inference_mode == "hybrid" and payload.model == settings.llm_model_id:
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
