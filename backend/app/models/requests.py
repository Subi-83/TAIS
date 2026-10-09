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


class RequestStatus(BaseModel):
    request_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    model: str
    experiment_id: str | None = None
    queue_wait_ms: float | None = None
    error: str | None = None
    response: InferenceResponse | None = None
