"""Token accounting that never labels a heuristic as exact."""

import asyncio
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TokenCount:
    count: int
    method: str
    tokenizer: str | None
    duration_ms: float


class TokenCounter:
    def __init__(self, tokenizer_id: str | None = None) -> None:
        self.tokenizer_id = tokenizer_id
        self._tokenizer = None
        if tokenizer_id:
            try:
                from transformers import AutoTokenizer
                self._tokenizer = AutoTokenizer.from_pretrained(tokenizer_id, local_files_only=True)
            except Exception:
                self._tokenizer = None

    async def count(self, text: str) -> TokenCount:
        loop = asyncio.get_running_loop()
        start = loop.time()
        if self._tokenizer:
            count = await asyncio.to_thread(lambda: len(self._tokenizer.encode(text, add_special_tokens=False)))
            return TokenCount(count, "tokenizer_exact", self.tokenizer_id, (loop.time() - start) * 1000)
        # Conservative fallback approximation: word/punctuation units, explicitly not exact.
        return TokenCount(len(re.findall(r"\w+|[^\w\s]", text)), "estimated", None, (loop.time() - start) * 1000)
