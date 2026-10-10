# Token-Aware Inference Request Scheduler

## Ollama + Docker quick start

The Docker stack runs the React frontend and scheduling gateway and connects the
gateway to Ollama on the Windows host. Start Ollama and then the stack:

```powershell
ollama pull gemma4:12b
ollama serve
docker compose up --build
```

Open `http://localhost:5173`. The token-aware policy uses
`estimated_cost = input_tokens + predefined_output_tokens`, followed by
`score = estimated_cost - aging_weight * wait_time_seconds`; the lowest score
runs first. Each logical backend worker processes one request at a time. A new
worker is enabled whenever the queue exceeds another 20-request boundary, up to
`SCALING_MAX_REPLICAS`.

The gateway does not run an LLM. It loads benchmark questions from
`WORKLOAD_EXCEL_PATH` and predicts output tokens with a deterministic keyword
heuristic. `BACKEND_OLLAMA_MODEL` (default `gemma4:12b`) exclusively handles
scheduled inference through `OLLAMA_BASE_URL`. Startup never downloads models;
a missing backend model produces a diagnostic with the required pull command.
`BACKEND_REPLICA_COUNT` controls how many independently scheduled logical
workers share that backend model endpoint (Docker Compose starts with four).

Submit a chat batch to `POST /api/requests/bulk` with this shape:

```json
{
  "requests": [
    {"model": "gemma4:12b", "messages": [{"role": "user", "content": "Hello"}]},
    {"model": "gemma4:12b", "messages": [{"role": "user", "content": "Explain queues"}]}
  ]
}
```

This repository currently implements **Phase 2**: a FastAPI gateway that validates inference requests and forwards them either to a deterministic mock backend or to a configured OpenAI-compatible model server such as vLLM.

The gateway never loads an LLM itself. It provides gateway-level scheduling, SSE monitoring, experiments, SQLite persistence, dry-run scaling decisions, and labeled token accounting; model-server GPU batching and real replica orchestration remain external to the gateway.

## How it runs

```text
Client → Gateway (port 8000) → Mock inference backend (port 8001)
```

Keep both processes running. The gateway uses `MOCK_BACKEND_URL` from `.env` to reach the mock backend.

## Prerequisites

- Ubuntu (or another Linux/macOS environment)
- Python 3.11 or newer
- `curl` for the examples

Check your Python version:

```bash
python3 --version
```

## First-time setup

Run these commands from the repository root:

```bash
sudo apt update
sudo apt install -y python3 python3-venv

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

cp .env.example .env
export PYTHONPATH="$PWD/backend"
```

The default `.env` is ready for mock mode:

```dotenv
INFERENCE_MODE=mock
MOCK_BACKEND_URL=http://127.0.0.1:8001
REQUEST_TIMEOUT_SECONDS=15
MAX_PROMPT_CHARS=20000
```

## Start the project

Open two terminals in the repository root.

### Terminal 1 — start the mock backend

```bash
source .venv/bin/activate
export PYTHONPATH="$PWD/backend"
uvicorn mock_backend.main:app --host 127.0.0.1 --port 8001 --reload
```

Confirm it is healthy in a third terminal:

```bash
curl http://127.0.0.1:8001/health
```

Expected response:

```json
{"status":"ok","backend_id":"mock-backend-1","models":["mock-echo-1"]}
```

### Terminal 2 — start the gateway

```bash
source .venv/bin/activate
export PYTHONPATH="$PWD/backend"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Interactive API documentation is available at <http://127.0.0.1:8000/docs>.

## Use the API

### Check gateway and backend health

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/system/status
```

### Send a chat-style inference request

```bash
curl -X POST http://127.0.0.1:8000/api/requests \
  -H 'content-type: application/json' \
  -d '{
    "model": "mock-echo-1",
    "messages": [{"role": "user", "content": "Explain queues."}],
    "max_output_tokens": 64
  }'
```

Example response:

```json
{
  "request_id": "<generated UUID>",
  "model": "mock-echo-1",
  "output": "[mock:mock-echo-1] Explain queues.",
  "input_tokens": 2,
  "output_tokens": 3,
  "simulated": true
}
```

The token fields are simple mock estimates in Phase 1, not tokenizer-accurate counts.

Set `LLM_TOKENIZER_ID` to a compatible tokenizer already available locally to obtain tokenizer-based input accounting. Otherwise the gateway uses an explicitly labeled approximation; it never claims character or word counts are exact model tokens. `LLM_MAX_CONTEXT_TOKENS` rejects requests whose estimated input plus requested output cannot fit.

### Send a prompt-style request

Pass either `prompt` or `messages`, but never both:

```bash
curl -X POST http://127.0.0.1:8000/api/requests \
  -H 'content-type: application/json' \
  -d '{"model":"mock-echo-1","prompt":"Hello from the gateway.","max_output_tokens":64}'
```

## Run tests

With the virtual environment active:

```bash
export PYTHONPATH="$PWD/backend"
pytest -q
```

The Phase 1/2 suite validates mock inference, gateway forwarding, real-adapter request formatting, model discovery, usage parsing, and common provider errors. It does not require either server process to be running.

## Stop the project

Press `Ctrl+C` in each Uvicorn terminal.

## Run with Docker Compose

Docker Compose starts the gateway and a separate mock backend; it does not package an LLM or require a GPU.

```bash
docker compose up --build
```

Then use `http://127.0.0.1:8000/docs`. Stop the stack with `docker compose down`.

The same Compose command also starts the Vite dashboard at `http://127.0.0.1:5173`. In the browser, select Live Mode from Settings. The browser reaches the gateway through the host-mapped `http://localhost:8000` URL.

`GET /api/system/status` exposes queue depth, active request count, periodic backend-health state, dry-run scaling state, and aggregate metrics for monitoring clients.

## Scheduler, experiments, and monitoring

The mock runtime includes a FIFO or token-aware queue. Token-aware mode selects lower estimated token work first, while requests that exceed the configured maximum wait are promoted to prevent starvation.

```bash
curl http://127.0.0.1:8000/api/scheduler/config
curl -X PUT http://127.0.0.1:8000/api/scheduler/config \
  -H 'content-type: application/json' \
  -d '{"policy":"token_aware","max_wait_seconds":30,"max_queue":1000}'
curl http://127.0.0.1:8000/api/backends
curl http://127.0.0.1:8000/api/scaling/status
```

Experiments accept an explicit request list and publish lifecycle events through SSE at `GET /api/experiments/{experiment_id}/events`. SSE supports bounded replay through `Last-Event-ID`; a slow client receives `stream_resync_required` and should fetch the experiment snapshot/metrics again.

For reproducible synthetic experiments, submit `workload_profile` (`short_interactive`, `mixed`, `long_context`, `high_output`, `burst`, or `sustained`), `request_count`, `model`, and `random_seed` to `POST /api/experiments`. Reuse the same seed and generated trace when comparing policies.

Non-streaming inference is scheduled. Streaming inference is exposed separately at `POST /api/requests/stream` as SSE events (`request_started`, `token`, `usage`, `request_completed`, `request_error`). A provider chunk is not assumed to equal one model token.

Development-only mock fault injection is disabled by default. Set `ENABLE_DEV_FAULT_INJECTION=true` only for local testing, then use `POST /api/dev/backends/mock-backend-1/faults` to inject latency, failure rate, or unhealthy status. Do not enable it in production.

For production, set `MANAGEMENT_API_KEY` and send it in `X-API-Key` for experiment, scheduler, scaling, and development-management endpoints. Set `CORS_ORIGINS` to a comma-separated allow-list; leaving it empty does not enable cross-origin access. `MAX_REQUEST_BYTES` caps declared request bodies.

## Frontend connection

The Vite dashboard in `frontend/` is connected to the gateway through `VITE_API_BASE_URL` (default `http://localhost:8000`). Run it separately:

```bash
cd frontend
npm run dev
```

Switch the dashboard from Demo Mode to Live Mode in Settings. The dashboard uses gateway health, scheduler, backend, experiment, report, and SSE endpoints. For local cross-origin development, set `CORS_ORIGINS=http://localhost:5173` in the backend `.env` and restart the gateway.

## Run against a real vLLM-compatible server

Phase 2 supports non-streaming **chat completions** through an independently running OpenAI-compatible server. vLLM must be started separately; this repository does not download or load a model.

1. Start a compatible server and obtain its advertised model ID from `GET /v1/models`.
2. Set the real-provider configuration in `.env` (the model ID must match discovery exactly):

```dotenv
INFERENCE_MODE=real
LLM_PROVIDER=vllm
LLM_BASE_URL=http://127.0.0.1:8001/v1
LLM_API_KEY=
LLM_MODEL_ID=your-served-model-id
LLM_VERIFY_MODEL_ID=true
```

3. Start only the gateway, then validate the connection:

```bash
source .venv/bin/activate
export PYTHONPATH="$PWD/backend"
uvicorn app.main:app --host 127.0.0.1 --port 8000

curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/models
```

4. Send a chat request using the configured model ID:

```bash
curl -X POST http://127.0.0.1:8000/api/requests \
  -H 'content-type: application/json' \
  -d '{"model":"your-served-model-id","messages":[{"role":"user","content":"Say hello."}],"max_output_tokens":32}'
```

Real mode requires `LLM_BASE_URL` and `LLM_MODEL_ID` at startup. Connection, authentication, unavailable-model, timeout, and provider HTTP failures are returned clearly; the gateway never falls back to mock inference. Real providers support chat-style `messages`; text completions remain future work.

### Ollama

Ollama is also supported for local chat inference. Set `LLM_PROVIDER=ollama`,
`OLLAMA_BASE_URL=http://127.0.0.1:11434`, and
`BACKEND_OLLAMA_MODEL=gemma4:12b`. The application verifies the exact backend
model through Ollama's `/api/tags` endpoint and never silently substitutes it.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Gateway health returns `503` | Start the mock backend and confirm `.env` has `MOCK_BACKEND_URL=http://127.0.0.1:8001`. |
| `ModuleNotFoundError` | Activate `.venv`, reinstall with `python -m pip install -r requirements.txt`, and set `PYTHONPATH`. |
| Port already in use | Stop the process using port 8000/8001, or choose another backend port and update `MOCK_BACKEND_URL` to match. |
| Request returns `422` | Send exactly one of `prompt` or non-empty `messages`; `max_output_tokens` must be from 1 to 4096. |

## Docker worker autoscaling

Real worker lifecycle management is opt-in. Set `DOCKER_WORKER_MANAGER_ENABLED=true`,
`SCALING_DRY_RUN=false`, and configure the minimum, maximum, and idle timeout.
The gateway then creates only containers labelled
`com.tais.worker-owner=tais-worker-manager`; ownership is revalidated before
stop or removal. One Compose-managed worker remains warm when the minimum is one.

The Docker socket mount grants privileged control of the Docker daemon. Enable it
only on a trusted host, protect management endpoints with `MANAGEMENT_API_KEY`,
and do not expose the gateway management API publicly. The manager never stops
the host Ollama process or containers without its exact ownership label.

Lifecycle status and persisted startup/removal events are available from
`GET /api/scaling/status`. Development fault observations are available from
`GET /api/fault-recovery/latest`; creating a run requires mock mode and
`ENABLE_DEV_FAULT_INJECTION=true`.

## Verification status

The automated suite exercises OpenAI-compatible model discovery, authorization errors, model handling, request formatting, response/usage parsing, and gateway forwarding using controlled HTTP transports. A live vLLM endpoint was not configured in this workspace, so real-provider verification remains pending.
