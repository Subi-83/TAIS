import pytest

from app.tokenization.token_counter import TokenCounter


@pytest.mark.asyncio
async def test_fallback_token_counter_is_explicitly_labeled_estimated():
    result = await TokenCounter().count("Hello, scheduler!")
    assert result.count == 4
    assert result.method == "estimated"
    assert result.tokenizer is None
    assert result.duration_ms >= 0
