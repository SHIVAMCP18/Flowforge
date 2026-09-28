# FlowForge

**Live demo:** [flowforge-eosin.vercel.app](https://flowforge-eosin.vercel.app/) — the dashboard
runs an in-browser simulation of the scheduler and worker pool, so you can build, run, cancel
and resume workflows without deploying the backend.

A distributed workflow orchestration engine: define multi-step jobs as a
DAG of tasks with explicit dependencies, and FlowForge schedules,
retries, times out, and checkpoints them across a horizontally-scalable
worker pool.

- **control-plane** (Java 21, Spring Boot, PostgreSQL) — DAG validation,
  scheduling, retries, timeouts, durable checkpointing, cancel & resume
- **worker** (Go) — polls for leased tasks, executes them with their
  upstream outputs in the environment, reports back
- **dashboard** (React + Vite) — live DAG visualisation, run timeline,
  workflow builder with validation, and an in-browser demo cluster
- **Docker Compose** for local dev, **Kubernetes** manifests (with worker
  autoscaling) for production-shaped deployment
- **load-test/** — a Go throughput/latency harness for stress-testing a
  running deployment

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the scheduler,
leasing, retries, and crash-safety actually work.

## Quickstart (Docker Compose)

```bash
docker compose up --build
```

This starts Postgres, one control-plane instance, and one worker (pool
size 4). To simulate a larger worker fleet locally:

```bash
docker compose up --build --scale worker=5
```

Then open the dashboard:

```bash
cd dashboard && npm install && npm run dev   # http://localhost:5173
```

### Submit a workflow

```bash
curl -X POST http://localhost:8080/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "etl-pipeline",
    "tasks": [
      { "name": "extract", "command": "echo rows=1200" },
      { "name": "transform", "dependsOn": ["extract"], "command": "echo \"cleaned $FLOWFORGE_UPSTREAM_EXTRACT\"" },
      { "name": "load", "dependsOn": ["transform"], "command": "echo loading", "timeoutSeconds": 30, "maxRetries": 2 }
    ]
  }'
# => { "id": "<definitionId>", "name": "etl-pipeline", "version": 1 }
```

Registering the same name again creates version 2. To check a definition
without saving it, `POST /api/workflows/validate` returns the execution plan
(which tasks run in parallel at each stage) or the validation error.

### Start a run and watch it

```bash
curl -X POST http://localhost:8080/api/workflows/<definitionId>/runs
curl http://localhost:8080/api/workflows/runs/<runId>
```

The run view includes every task's status, attempt count, worker,
dependencies, captured output (checkpoint) and last error.

## Writing tasks

Each task is a shell command run with `sh -c` on a worker. Stdout and
stderr (up to 4 KB) become the task's checkpoint. The worker sets:

| Variable | Value |
|---|---|
| `FLOWFORGE_RUN_ID` | ID of the workflow run |
| `FLOWFORGE_TASK_RUN_ID` | ID of this task execution |
| `FLOWFORGE_TASK_NAME` | Task name |
| `FLOWFORGE_ATTEMPT` | Attempt number, starting at 1 |
| `FLOWFORGE_WORKER_ID` | Worker slot running the task |
| `FLOWFORGE_UPSTREAM_<TASK>` | Output of a dependency; the name is upper-cased with non-alphanumerics as `_` (`fetch-data` → `FLOWFORGE_UPSTREAM_FETCH_DATA`) |
| `FLOWFORGE_UPSTREAM_JSON` | All dependency outputs as a JSON object keyed by task name |

A non-zero exit code or running past `timeoutSeconds` fails the attempt. On
timeout the worker kills the command's whole process group, so child
processes can't outlive it. Failed attempts are retried with linear backoff
until `maxRetries` attempts have been used (`maxRetries` is the total number
of attempts); after that the run fails and downstream tasks are marked
`SKIPPED`.

## API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workflows` | List workflow definitions (all versions, newest first) |
| POST | `/api/workflows` | Register a definition (validates the DAG) |
| POST | `/api/workflows/validate` | Dry-run validation; returns the execution plan |
| GET | `/api/workflows/{id}` | Get one definition |
| POST | `/api/workflows/{id}/runs` | Start a run of a definition |
| GET | `/api/workflows/runs?status=&definitionId=&limit=` | List recent runs with per-status task counts |
| GET | `/api/workflows/runs/{runId}` | Get run + per-task status, output and errors |
| POST | `/api/workflows/runs/{runId}/cancel` | Cancel a running run |
| POST | `/api/workflows/runs/{runId}/retry` | Resume a failed/cancelled run from its checkpoints |
| POST | `/api/workers/{workerId}/lease` | (worker-internal) Lease the next READY task |
| POST | `/api/tasks/{taskRunId}/complete` | (worker-internal) Report success + checkpoint data |
| POST | `/api/tasks/{taskRunId}/fail` | (worker-internal) Report failure |

Errors come back as `{"error": "..."}` with 400 (invalid input), 404
(unknown ID) or 409 (the request conflicts with the current state, e.g.
cancelling a finished run, or a worker reporting on a lease it no longer
holds).

## Dashboard

`dashboard/` is a React app for operating and developing workflows:

- **Live execution graph** — the DAG laid out by stage; edges animate while
  data flows into running tasks, and nodes pulse, pop or shake as they
  change state. Click any task for its command, output, error and
  dependencies.
- **Timeline** — a Gantt view of every task on a shared time axis, so
  parallelism and queueing are easy to see.
- **Workflow builder** — templates, dependency toggles, instant validation
  (duplicates, unknown dependencies, cycles), a live graph preview with the
  execution plan, a JSON editor, import/export, and a ready-to-paste `curl`.
- **Run controls** — cancel running runs; resume failed or cancelled runs
  from their last checkpoints.
- **Developer guide** — the API and task environment, with copyable
  snippets.
- Keyboard shortcuts (`N` new workflow, `D` dashboard, `/` search, `?` help).

If no control plane is reachable (for example on a static Vercel deploy),
the dashboard switches to a **demo cluster** that simulates the scheduler
and worker pool in the browser, so everything stays interactive. Point it at
a real control plane from the connection panel in the sidebar, or at build
time with `VITE_API_BASE_URL`. Browser access from another origin needs
`CORS_ALLOWED_ORIGINS` on the control plane (comma-separated; patterns such
as `https://*.vercel.app` are allowed).

## Running on Kubernetes

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/control-plane.yaml
kubectl apply -f k8s/worker.yaml
```

Build and push the two images first (or point the manifests at your own
registry):

```bash
docker build -t <registry>/flowforge-control-plane:latest ./control-plane
docker build -t <registry>/flowforge-worker:latest ./worker
```

`k8s/worker.yaml` includes a `HorizontalPodAutoscaler` that scales the
worker Deployment 3→20 pods on CPU utilization — this is the "autoscaling
worker pools" piece: because leasing is a stateless pull against Postgres,
scaling worker replicas up or down needs no coordination.

## Load testing

```bash
cd load-test
go run . -url=http://localhost:8080 -runs=200 -concurrency=50
```

This registers a 3-task DAG, fires 200 concurrent runs, and prints
throughput (runs/sec) and p50/p95/p99 run latency once every run has
finished or timed out. Point `-url` at a Kubernetes-exposed control-plane
Service to validate throughput under a production-like deployment instead
of local Compose.

## Running tests

```bash
cd control-plane && mvn test   # DAG validation unit tests
cd worker && go test ./...      # executor + control-plane client
cd dashboard && npm run lint && npm run build
```

The scheduler integration tests (leasing, fan-out, retries, stale
callbacks, cancel and resume) need a real, disposable Postgres database
because leasing relies on `FOR UPDATE SKIP LOCKED`:

```bash
FLOWFORGE_TEST_DB_URL=jdbc:postgresql://localhost:5432/flowforge_test mvn test
# or: make test-control-plane-it
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `localhost` / `5432` / `flowforge` / `flowforge` / `flowforge` | Postgres connection |
| `REAPER_INTERVAL_MS` | `5000` | How often expired leases are reclaimed |
| `RETRY_BACKOFF_SECONDS` | `5` | Linear backoff step between attempts |
| `DEFAULT_TASK_TIMEOUT_SECONDS` | `60` | Timeout when a task doesn't set one |
| `DEFAULT_MAX_RETRIES` | `3` | Attempts when a task doesn't set `maxRetries` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Browser origins allowed to call `/api/**` |
| `CONTROL_PLANE_URL` (worker) | `http://localhost:8080` | Where the worker leases work |
| `POOL_SIZE` (worker) | `4` | Concurrent tasks per worker process |
| `POLL_INTERVAL_MS` (worker) | `500` | Idle poll interval |
| `VITE_API_BASE_URL` (dashboard) | same origin | Control plane URL baked into the dashboard build |

## Project layout

```
control-plane/   Spring Boot service — scheduling, retries, checkpointing
worker/          Go polling worker
dashboard/       React dashboard (Vite)
load-test/       Go throughput/latency stress-test harness
k8s/             Kubernetes manifests (Postgres, control-plane, worker + HPA)
docs/            Architecture notes
docker-compose.yml
```
