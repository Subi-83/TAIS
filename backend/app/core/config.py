from functools import lru_cache

from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed configuration for mock and real inference modes."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    inference_mode: Literal["mock", "real", "hybrid"] = "mock"
    mock_backend_url: str = "http://127.0.0.1:8001"
    request_timeout_seconds: float = Field(default=60, gt=0, le=300)
    llm_provider: Literal["vllm", "openai_compatible", "ollama"] = "vllm"
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model_id: str | None = None
    ollama_base_url: str | None = None
    backend_ollama_model: str = "gemma4:12b"
    token_predictor_model: str = "qwen3:4b-q4_K_M"
    token_predictor_enabled: bool = True
    token_predictor_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    backend_replica_count: int = Field(default=1, ge=1, le=32)
    workload_excel_path: str = "./backend/data/D07_150_Questions_Token_Predictor.xlsx"
    llm_backends_json: str | None = None
    llm_verify_model_id: bool = True
    llm_connect_timeout_seconds: float = Field(default=10, gt=0, le=60)
    max_prompt_chars: int = Field(default=20_000, gt=0, le=1_000_000)
    scheduler_policy: Literal["fifo", "token_aware"] = "fifo"
    scheduler_max_wait_seconds: float = Field(default=2, gt=0, le=3600)
    scheduler_aging_weight: float = Field(default=1.0, ge=0, le=10_000)
    scheduler_max_bypass: int = Field(default=8, ge=1, le=10_000)
    starvation_slowdown_limit: float = Field(default=3.0, gt=0, le=1000)
    scheduler_output_token_weight: float = Field(default=1.0, ge=0, le=100)
    starvation_threshold_ms: float = Field(default=2000, ge=300, le=3_600_000)
    scheduler_default_output_tokens: int = Field(default=128, ge=1, le=4096)
    scheduler_max_queue: int = Field(default=1000, gt=0, le=100_000)
    scaling_min_replicas: int = Field(default=1, ge=0, le=100)
    scaling_max_replicas: int = Field(default=3, ge=1, le=100)
    scaling_queue_per_replica: int = Field(default=20, ge=1, le=100_000)
    scaling_dry_run: bool = True
    docker_worker_manager_enabled: bool = False
    docker_socket_path: str = "/var/run/docker.sock"
    docker_worker_image: str = "tais-gateway:latest"
    docker_worker_network: str = "tais_default"
    docker_worker_idle_timeout_seconds: float = Field(default=30, ge=1, le=3600)
    docker_worker_startup_timeout_seconds: float = Field(default=60, ge=1, le=600)
    docker_worker_poll_seconds: float = Field(default=1, ge=0.1, le=60)
    docker_worker_owner: str = "tais-worker-manager"
    database_url: str = "sqlite:///./scheduler.db"
    enable_dev_fault_injection: bool = False
    health_check_interval_seconds: float = Field(default=10, gt=0, le=300)
    backend_max_retries: int = Field(default=2, ge=0, le=10)
    backend_retry_backoff_seconds: float = Field(default=1, ge=0, le=30)
    backend_circuit_failure_threshold: int = Field(default=3, ge=1, le=100)
    backend_circuit_recovery_seconds: float = Field(default=15, gt=0, le=600)
    artifacts_root: str = "./artifacts"
    llm_tokenizer_id: str | None = None
    llm_max_context_tokens: int | None = Field(default=None, gt=0)
    max_request_bytes: int = Field(default=1_000_000, gt=0, le=20_000_000)
    cors_origins: str = ""
    management_api_key: str | None = None

    @model_validator(mode="after")
    def validate_real_mode(self) -> "Settings":
        if self.inference_mode in {"real", "hybrid"}:
            if self.llm_provider == "ollama":
                if not (self.ollama_base_url or self.llm_base_url):
                    raise ValueError("OLLAMA_BASE_URL must be set when using Ollama")
                if not self.backend_ollama_model.strip():
                    raise ValueError("BACKEND_OLLAMA_MODEL must not be empty")
                return self
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
