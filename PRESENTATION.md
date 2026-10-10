# Token-Aware Multi-Model Inference Gateway

## 1 — Objective

- Accept single and bulk LLM requests through one gateway.
- Compare FIFO and D07 token-aware scheduling on identical workloads.
- Prevent starvation with aging.
- Route requests to healthy backends that serve the requested model.
- Preserve request inputs, outputs, calculations, and performance evidence.

---

## 2 — System Architecture

```text
React UI → FastAPI Gateway → Scheduler → Model-Aware Backend Pool → Ollama
                │               │                    │
                ├─ SSE monitor  ├─ FIFO / D07       ├─ health checks
                ├─ SQLite       ├─ queue aging      ├─ retry agent
                └─ artifacts    └─ capacity control └─ circuit breaker
```

---

## 3 — LLM-Generated Paired Workload

1. The gateway asks the configured LLM to generate realistic prompts for the selected profile.
2. The LLM predicts the useful output-token requirement for each prompt.
3. The gateway creates an identical FIFO run and D07 run.
4. FIFO completes first; D07 then runs on the same backend capacity for a fair comparison.

---

## 4 — Scheduling Algorithm

```text
estimated_cost = estimated_input_tokens + llm_predicted_output_tokens
score = estimated_cost - aging_weight × waiting_time_seconds
```

- D07 dispatches the lowest score first.
- Aging continuously lowers waiting-request scores and prevents starvation.
- FIFO dispatches strictly by arrival time.
- Backend count is gateway-managed, not selected by the experiment creator.

---

## 5 — Multi-Model Backend Routing

- Every backend declares its backend ID, endpoint, provider, model, and concurrency.
- The gateway filters by requested model and health.
- Open-circuit and fully occupied backends are excluded.
- The least-loaded eligible backend receives the request.
- Each backend maintains an independent retry and circuit-breaker agent.

---

## 6 — Observability

- Live queue, completion, throughput, p95 latency, TTFT, workers, and utilization cards.
- Per-request prompt preview, token prediction, cost, live score, backend, TTFT, and completion latency.
- SSE lifecycle, retry, circuit-open, and recovery events.
- Separate persistent input and output text artifacts for every request.

---

## 7 — TTFT vs Completion Latency

- TTFT measures time from backend dispatch until the first generated token.
- Completion latency measures time until the final generated token.
- Ollama is consumed as a stream internally so these values are independently measured.

---

## 8 — Fault Tolerance

- Two bounded retries with exponential backoff.
- Circuit opens after three consecutive retryable failures.
- Half-open recovery probe after 15 seconds.
- Unhealthy backends receive no new work.
- Recovery events appear in the live monitor.

---

## 9 — Evidence and Reproducibility

- Experiment metadata and request lifecycle are stored in SQLite.
- Inputs: `artifacts/inputs/<experiment-id>/<request-id>.txt`
- Outputs: `artifacts/outputs/<experiment-id>/<request-id>.txt`
- FIFO and D07 use the exact same LLM-generated prompt set and token predictions.

---

## 10 — Demonstration Flow

1. Start Ollama with `ollama run gemma4:12b`.
2. Start the stack with `docker compose up --build`.
3. Select a workload profile and model.
4. Start the paired benchmark.
5. Monitor FIFO, then D07.
6. Open Performance Compare for final results.
7. Inspect input/output artifacts for request-level evidence.
