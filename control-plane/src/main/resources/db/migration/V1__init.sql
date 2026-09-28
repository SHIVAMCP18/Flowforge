-- FlowForge core schema
-- All workflow state lives here so the control plane is stateless and
-- crash-safe: any instance can resume scheduling by reading this table set.

CREATE TABLE workflow_definitions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    dag_json      TEXT NOT NULL,          -- serialized task graph (name, dependsOn, command, timeout, retries)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE workflow_runs (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_definition_id   UUID NOT NULL REFERENCES workflow_definitions(id),
    status                   VARCHAR(20) NOT NULL DEFAULT 'RUNNING', -- RUNNING, SUCCEEDED, FAILED
    started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at             TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);

CREATE TABLE task_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id    UUID NOT NULL REFERENCES workflow_runs(id),
    task_name          VARCHAR(255) NOT NULL,
    depends_on_json    TEXT NOT NULL DEFAULT '[]',   -- denormalized upstream task names
    command            TEXT NOT NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                       -- PENDING -> READY -> RUNNING -> SUCCEEDED
                       --                            -> (retry) READY
                       --                            -> FAILED  -> (cascades to SKIPPED downstream)
    attempt            INTEGER NOT NULL DEFAULT 0,
    max_retries        INTEGER NOT NULL DEFAULT 3,
    timeout_seconds     INTEGER NOT NULL DEFAULT 60,
    worker_id          VARCHAR(255),
    lease_expires_at   TIMESTAMPTZ,
    next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    checkpoint_data    TEXT,              -- durable output of this task, consumed by downstream tasks
    error_message      TEXT,
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_runs_workflow_run ON task_runs(workflow_run_id);
-- The scheduler's hot path: find leasable work fast.
CREATE INDEX idx_task_runs_ready_lease ON task_runs(status, next_attempt_at) WHERE status = 'READY';
-- The reaper's hot path: find expired leases fast.
CREATE INDEX idx_task_runs_running_lease ON task_runs(status, lease_expires_at) WHERE status = 'RUNNING';
