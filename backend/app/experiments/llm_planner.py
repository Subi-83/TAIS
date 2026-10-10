import re
import time
from pathlib import Path

from openpyxl import load_workbook

from app.models.requests import InferenceRequest


HEAVY = ["implement", "design", "essay", "tutorial", "comprehensive", "in depth", "in-depth", "detailed",
         "analyze", "prove", "itinerary", "proposal", "report", "story", "complete", "thorough", "speech",
         "checklist", "postmortem", "business plan", "review", "step by step", "step-by-step", "guide",
         "derivation", "architecture"]
MEDIUM = ["explain", "describe", "compare", "summarize", "list", "why", "how does", "how do",
          "difference", "example", "discuss", "write", "give", "tips", "what are"]
SHORT = ["briefly", "one word", "one sentence", "yes or no", "in short", "in simple terms", "short"]
BASE = {"light": 30, "medium": 200, "heavy": 700}


def predict_tokens(prompt: str, cap: int = 1500, floor: int = 5) -> int:
    p = prompt.lower()
    match = re.search(r"(\d+)\s*words", p)
    if match:
        return round(min(cap, max(floor, int(match.group(1)) * 1.3)))
    heavy = sum(keyword in p for keyword in HEAVY)
    medium = sum(keyword in p for keyword in MEDIUM)
    short = sum(keyword in p for keyword in SHORT)
    conjunctions = p.count(",") + p.count(" and ")
    tier = "heavy" if heavy else "medium" if medium else "light"
    matches = heavy if heavy else medium
    estimate = BASE[tier] * (1 + 0.15 * max(matches - 1, 0) + 0.1 * conjunctions) / (1 + 0.5 * short)
    return round(max(floor, min(cap, estimate)))


class ExcelWorkloadPlanner:
    """Loads benchmark prompts from the configured workbook."""

    def __init__(self, workbook_path: str, repository=None, token_predictor=None) -> None:
        self.workbook_path = Path(workbook_path)
        self.repository = repository
        self.token_predictor = token_predictor

    def _prediction(self, model: str, question_id: str, difficulty: str, prompt: str) -> tuple[int, str, int]:
        fallback = predict_tokens(prompt)
        if not self.repository:
            return fallback, "deterministic_heuristic", 0
        history = self.repository.token_prediction_history(model)
        exact = [item["actual_output_tokens"] for item in history if item.get("question_id") == question_id and item["actual_output_tokens"] > 0]
        peers = [item["actual_output_tokens"] for item in history if item.get("difficulty") == difficulty and item["actual_output_tokens"] > 0]
        samples = exact or peers
        if not samples:
            return fallback, "deterministic_heuristic", 0
        # A conservative upper-mean estimate avoids using a previous answer as
        # an exact target while adapting the broad heuristic to this model.
        calibrated = round(sum(samples) / len(samples) * 1.1)
        return max(5, min(1500, calibrated)), "historical_calibration", len(samples)

    async def _resolve_prediction(self, model: str, question_id: str, difficulty: str, prompt: str) -> tuple[int, str, int]:
        if self.token_predictor and getattr(self.token_predictor, "enabled", True):
            pred = await self.token_predictor.predict(prompt)
            return pred.predicted_tokens, pred.source, 0
        return self._prediction(model, question_id, difficulty, prompt)

    def _questions(self) -> list[tuple[str, str, str]]:
        if not self.workbook_path.is_file():
            raise ValueError(f"benchmark workbook was not found: {self.workbook_path}")
        workbook = load_workbook(self.workbook_path, read_only=True, data_only=True)
        try:
            if "Questions" not in workbook.sheetnames:
                raise ValueError("benchmark workbook must contain a 'Questions' sheet")
            rows = workbook["Questions"].iter_rows(values_only=True)
            headers = {str(value).strip(): index for index, value in enumerate(next(rows)) if value is not None}
            required = {"ID", "Difficulty", "Question"}
            missing = required - headers.keys()
            if missing:
                raise ValueError(f"benchmark workbook is missing columns: {sorted(missing)}")
            questions = []
            for row in rows:
                prompt = row[headers["Question"]]
                if prompt and str(prompt).strip():
                    questions.append((str(row[headers["ID"]]), str(row[headers["Difficulty"]]), str(prompt).strip()))
            if not questions:
                raise ValueError("benchmark workbook contains no questions")
            return questions
        finally:
            workbook.close()

    async def generate(self, profile: str, count: int, model: str) -> list[InferenceRequest]:
        questions = self._questions()
        if count > len(questions):
            raise ValueError(f"requested {count} questions but workbook contains only {len(questions)}")
        selected = questions[:count]
        requests = []
        for question_id, difficulty, prompt in selected:
            prediction_started = time.monotonic()
            prediction, prediction_source, history_samples = await self._resolve_prediction(model, question_id, difficulty, prompt)
            prediction_latency_ms = (time.monotonic() - prediction_started) * 1000
            requests.append(InferenceRequest(
                model=model,
                prompt=prompt,
                max_output_tokens=max(128, prediction),
                expected_output_tokens=prediction,
                metadata={
                    "question_id": question_id,
                    "difficulty": difficulty,
                    "profile": profile,
                    "input_source": "excel",
                    "output_prediction_source": prediction_source,
                    "prediction_history_samples": history_samples,
                    "prediction_latency_ms": prediction_latency_ms,
                },
            ))
        return requests
