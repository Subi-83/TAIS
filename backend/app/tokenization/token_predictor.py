"""Output token prediction using a fast dedicated model (e.g., qwen3:4b-q4_K_M)."""

import asyncio
import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.experiments.llm_planner import predict_tokens

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE = (
    "Analyze the user query below and estimate the number of output tokens needed for an LLM response.\n\n"
    "Output Format: Return strictly an integer number representing the predicted output token count (e.g. 50). Do NOT answer the query. Do NOT output any words or explanation.\n\n"
    "Query: {query}\n\n"
    "Predicted output tokens:"
)


@dataclass(frozen=True)
class PredictionResult:
    predicted_tokens: int
    source: str
    latency_ms: float
    model: str


class TokenPredictor:
    """Predicts expected output tokens for incoming requests using a dedicated lightweight LLM."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str = "qwen3:4b-q4_K_M",
        timeout_seconds: float = 5.0,
        enabled: bool = True,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or "http://127.0.0.1:11434").rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.enabled = enabled
        self.transport = transport
        self._cache: dict[str, int] = {}

    async def predict(self, query: str, default_tokens: int | None = None) -> PredictionResult:
        clean_query = (query or "").strip()
        if not clean_query:
            fallback = default_tokens or 30
            return PredictionResult(
                predicted_tokens=fallback,
                source="default",
                latency_ms=0.0,
                model=self.model,
            )

        if clean_query in self._cache:
            return PredictionResult(
                predicted_tokens=self._cache[clean_query],
                source=f"{self.model}:cache",
                latency_ms=0.0,
                model=self.model,
            )

        if not self.enabled:
            heuristic = predict_tokens(clean_query)
            return PredictionResult(
                predicted_tokens=heuristic,
                source="deterministic_heuristic",
                latency_ms=0.0,
                model=self.model,
            )

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds, transport=self.transport) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": PROMPT_TEMPLATE.format(query=clean_query),
                        "stream": False,
                        "think": False,
                        "options": {
                            "num_predict": 16,
                            "temperature": 0.0,
                            "stop": ["\n", " "],
                        },
                    },
                )
                response.raise_for_status()
                data = response.json()
                raw_text = str(data.get("response", "")).strip()
                match = re.search(r"\d+", raw_text)
                if match:
                    predicted = max(5, min(4096, int(match.group(0))))
                    elapsed = (time.monotonic() - start) * 1000
                    self._cache[clean_query] = predicted
                    return PredictionResult(
                        predicted_tokens=predicted,
                        source=self.model,
                        latency_ms=elapsed,
                        model=self.model,
                    )
                logger.warning(
                    "Token predictor (%s) returned non-integer response: %r",
                    self.model,
                    raw_text,
                )
        except Exception as exc:
            logger.warning(
                "Token predictor (%s) failed (%s), falling back to heuristic",
                self.model,
                exc,
            )

        elapsed = (time.monotonic() - start) * 1000
        heuristic = predict_tokens(clean_query)
        return PredictionResult(
            predicted_tokens=heuristic,
            source="deterministic_heuristic",
            latency_ms=elapsed,
            model=self.model,
        )
