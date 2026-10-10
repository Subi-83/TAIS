from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class InferenceRequest(BaseModel):
    model: str = Field(default="mock-echo-1", min_length=1, max_length=200)
    messages: list[Message] | None = None
    prompt: str | None = Field(default=None, min_length=1, max_length=20_000)
    max_output_tokens: int = Field(default=128, ge=1, le=4096)
    temperature: float = Field(default=0.0, ge=0, le=2)
    expected_output_tokens: int | None = Field(default=None, ge=1, le=4096)
    scheduler_policy: Literal["fifo", "token_aware"] | None = None
    priority: Literal["low", "normal", "high"] = "normal"
    experiment_id: str | None = Field(default=None, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def requires_messages_or_prompt(self) -> "InferenceRequest":
        if bool(self.messages) == bool(self.prompt):
            raise ValueError("provide exactly one of messages or prompt")
        return self


class InferenceResponse(BaseModel):
    request_id: str
    model: str
    output: str
    input_tokens: int
    output_tokens: int
    input_token_method: Literal["mock_estimate", "provider_reported", "unavailable"] = "mock_estimate"
    output_token_method: Literal["mock_estimate", "provider_reported", "unavailable"] = "mock_estimate"
    simulated: bool = True
    ttft_ms: float | None = None


class RequestStatus(BaseModel):
    request_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    model: str
    experiment_id: str | None = None
    queue_wait_ms: float | None = None
    error: str | None = None
    response: InferenceResponse | None = None
    request_kind: Literal["chat", "prompt"] = "chat"
    prompt_preview: str = ""
    priority: Literal["low", "normal", "high"] = "normal"
    input_tokens: int = 0
    estimated_output_tokens: int = 0
    estimated_cost: int = 0
    scheduling_score: float = 0
    assigned_backend: str | None = None
    assigned_container_id: str | None = None
    output_preview: str = ""
    prediction_latency_ms: float = 0
    output_prediction_source: str | None = None
    inference_latency_ms: float = 0
    total_latency_ms: float = 0
    ttft_ms: float | None = None
    actual_output_tokens: int | None = None
    prediction_absolute_error: int | None = None
    prediction_relative_error_pct: float | None = None
