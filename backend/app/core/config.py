from functools import lru_cache

from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed configuration for mock and real inference modes."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    inference_mode: Literal["mock", "real", "hybrid"] = "mock"
    mock_backend_url: str = "http://127.0.0.1:8001"
    request_timeout_seconds: float = Field(default=15, gt=0, le=120)
    llm_provider: Literal["vllm", "openai_compatible", "ollama"] = "vllm"
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model_id: str | None = None
    llm_verify_model_id: bool = True
    llm_connect_timeout_seconds: float = Field(default=10, gt=0, le=60)
    max_prompt_chars: int = Field(default=20_000, gt=0, le=1_000_000)
    scheduler_policy: Literal["fifo", "token_aware"] = "fifo"
    scheduler_max_wait_seconds: float = Field(default=30, gt=0, le=3600)
    scheduler_max_queue: int = Field(default=1000, gt=0, le=100_000)
    scaling_min_replicas: int = Field(default=1, ge=0, le=100)
    scaling_max_replicas: int = Field(default=3, ge=1, le=100)
    scaling_dry_run: bool = True
    database_url: str = "sqlite:///./scheduler.db"
    enable_dev_fault_injection: bool = False
    health_check_interval_seconds: float = Field(default=10, gt=0, le=300)
    llm_tokenizer_id: str | None = None
    llm_max_context_tokens: int | None = Field(default=None, gt=0)
    max_request_bytes: int = Field(default=1_000_000, gt=0, le=20_000_000)
    cors_origins: str = ""
    management_api_key: str | None = None

    @model_validator(mode="after")
    def validate_real_mode(self) -> "Settings":
        if self.inference_mode in {"real", "hybrid"}:
            missing = [
                name
                for name, value in {
                    "LLM_BASE_URL": self.llm_base_url,
                    "LLM_MODEL_ID": self.llm_model_id,
                }.items()
                if not value
            ]
            if missing:
                raise ValueError(f"{', '.join(missing)} must be set when INFERENCE_MODE is {self.inference_mode}")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
