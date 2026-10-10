from pathlib import Path

import pytest

from app.experiments.llm_planner import ExcelWorkloadPlanner, predict_tokens


WORKBOOK = Path(__file__).parents[1] / "backend" / "data" / "D07_150_Questions_Token_Predictor.xlsx"


def test_token_predictor_matches_requested_rules():
    assert predict_tokens("What is the capital of France?") == 30
    assert predict_tokens("Explain TCP and UDP") == 220
    assert predict_tokens("Write a detailed 100 words report") == 130
    assert predict_tokens("Explain briefly") == 133


@pytest.mark.asyncio
async def test_excel_questions_become_backend_requests_without_gateway_llm():
    requests = await ExcelWorkloadPlanner(str(WORKBOOK)).generate("short_interactive", 3, "gemma4:12b")

    assert [request.prompt for request in requests] == [
        "What is the capital of France?",
        "What is 12 multiplied by 8?",
        "Name the largest planet in our solar system.",
    ]
    assert {request.model for request in requests} == {"gemma4:12b"}
    assert [request.expected_output_tokens for request in requests] == [30, 30, 30]
    assert all(request.metadata["input_source"] == "excel" for request in requests)
    assert all(request.metadata["output_prediction_source"] == "deterministic_heuristic" for request in requests)


class HistoryRepository:
    def token_prediction_history(self, model):
        return [{"question_id": "Q001", "difficulty": "Easy", "profile": "short", "actual_output_tokens": 10}]


def test_historical_prediction_is_separate_from_generation_limit(tmp_path):
    planner = ExcelWorkloadPlanner("unused.xlsx", HistoryRepository())
    prediction, source, samples = planner._prediction("gemma4:12b", "Q001", "Easy", "question")
    assert prediction == 11
    assert source == "historical_calibration"
    assert samples == 1


@pytest.mark.asyncio
async def test_excel_loader_rejects_more_questions_than_available():
    with pytest.raises(ValueError, match="workbook contains only 150"):
        await ExcelWorkloadPlanner(str(WORKBOOK)).generate("short_interactive", 151, "gemma4:12b")
