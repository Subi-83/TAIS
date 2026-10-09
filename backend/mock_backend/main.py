import asyncio
import re

from fastapi import FastAPI
from pydantic import BaseModel, Field, model_validator

app = FastAPI(title="Mock Inference Backend", version="0.1.0-phase1")
faults = {"latency_ms": 0, "failure_rate": 0.0, "unhealthy": False}


class MockMessage(BaseModel):
    role: str
    content: str


class GenerateRequest(BaseModel):
    request_id: str
    model: str
    messages: list[MockMessage] | None = None
    prompt: str | None = None
    max_output_tokens: int = Field(ge=1)
    temperature: float = 0

    @model_validator(mode="after")
    def one_input(self) -> "GenerateRequest":
        if bool(self.messages) == bool(self.prompt):
            raise ValueError("provide exactly one of messages or prompt")
        return self


def token_estimate(text: str) -> int:
    """Deliberately labeled approximation; Phase 3 adds tokenizer accounting."""
    return len(re.findall(r"\S+", text))


@app.get("/health")
async def health() -> dict:
    if faults["unhealthy"]:
        return {"status": "unhealthy", "backend_id": "mock-backend-1"}
    return {"status": "ok", "backend_id": "mock-backend-1", "models": ["mock-echo-1"]}


@app.post("/v1/generate")
async def generate(payload: GenerateRequest) -> dict:
    import random

    if faults["unhealthy"] or random.random() < faults["failure_rate"]:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="injected mock backend failure")
    if faults["latency_ms"]:
        await asyncio.sleep(faults["latency_ms"] / 1000)
    input_text = payload.prompt or "\n".join(message.content for message in payload.messages or [])
    # Deterministic output makes Phase 1 development and tests repeatable.
    output = f"[mock:{payload.model}] {input_text}"[: payload.max_output_tokens * 8]
    await asyncio.sleep(0.01)
    return {
        "request_id": payload.request_id,
        "model": payload.model,
        "output": output,
        "input_tokens": token_estimate(input_text),
        "output_tokens": token_estimate(output),
        "simulated": True,
    }


@app.put("/dev/faults")
async def set_faults(payload: dict) -> dict:
    faults.update({key: payload[key] for key in faults if key in payload})
    faults["latency_ms"] = max(0, int(faults["latency_ms"]))
    faults["failure_rate"] = min(1.0, max(0.0, float(faults["failure_rate"])))
    faults["unhealthy"] = bool(faults["unhealthy"])
    return faults
