-- Support the dashboard's list endpoints: newest runs first (optionally
-- filtered by definition) and definitions grouped by name.
CREATE INDEX idx_workflow_runs_created_at ON workflow_runs(created_at DESC);
CREATE INDEX idx_workflow_runs_definition ON workflow_runs(workflow_definition_id, created_at DESC);
