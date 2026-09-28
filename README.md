# FlowForge

A distributed workflow orchestration engine: define multi-step jobs as a
DAG of tasks with explicit dependencies, and FlowForge schedules,
retries, times out, and checkpoints them across a horizontally-scalable
worker pool.

- **control-plane** (Java 21, Spring Boot, PostgreSQL) — DAG validation,
  scheduling, retries, timeouts, durable checkpointing
- **worker** (Go) — polls for leased tasks, executes them, reports back
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

### Submit a workflow

```bash
curl -X POST http://localhost:8080/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "etl-pipeline",
    "tasks": [
      { "name": "extract", "command": "echo extracting data" },
      { "name": "transform", "dependsOn": ["extract"], "command": "echo transforming" },
      { "name": "load", "dependsOn": ["transform"], "command": "echo loading", "timeoutSeconds": 30, "maxRetries": 2 }
    ]
  }'
# => { "id": "<definitionId>", "name": "etl-pipeline", "version": 1 }
```

### Start a run

```bash
curl -X POST http://localhost:8080/api/workflows/<definitionId>/runs
```

### Check status

```bash
curl http://localhost:8080/api/workflows/runs/<runId>
```

Watch the worker container logs to see it leasing, executing, and
reporting each task as the DAG unfolds.

## API summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workflows` | Register a new workflow definition (validates the DAG) |
| POST | `/api/workflows/{id}/runs` | Start a run of a definition |
| GET | `/api/workflows/runs/{runId}` | Get run + per-task status |
| POST | `/api/workers/{workerId}/lease` | (worker-internal) Lease the next READY task |
| POST | `/api/tasks/{taskRunId}/complete` | (worker-internal) Report success + checkpoint data |
| POST | `/api/tasks/{taskRunId}/fail` | (worker-internal) Report failure |

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
cd control-plane && mvn test   # DagValidator cycle/validation tests
cd worker && go test ./...
```

## Project layout

```
control-plane/   Spring Boot service — scheduling, retries, checkpointing
worker/          Go polling worker
load-test/       Go throughput/latency stress-test harness
k8s/             Kubernetes manifests (Postgres, control-plane, worker + HPA)
docs/            Architecture notes
docker-compose.yml
```
