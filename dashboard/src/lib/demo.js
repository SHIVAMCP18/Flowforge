// An in-browser stand-in for the control plane + worker pool. It implements
// the same API surface as the HTTP client and follows the same state
// machine as SchedulerService (READY -> RUNNING -> SUCCEEDED, retries with
// backoff, cascade SKIPPED on permanent failure, cancel, resume), so the
// dashboard behaves identically with or without a live backend.

import { computeLevels } from './dag';

const WORKERS = ['worker-7a2f-0', 'worker-7a2f-1', 'worker-3c1e-0', 'worker-3c1e-1', 'worker-9d4b-0'];
const TICK_MS = 250;
const BACKOFF_MS = 1500;

let seq = 0;
const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now().toString(16)}-${(seq++).toString(16)}-0000-000000000000`);

const iso = (ms = Date.now()) => new Date(ms).toISOString();

const TEMPLATE_OUTPUT = [
  [/extract|fetch|ingest|download/, () => `Fetched ${rand(40, 180) * 1000} rows from source\nWritten to /tmp/raw.parquet`],
  [/transform|clean|normalize/, () => `Applied ${rand(6, 18)} transformation rules\nNull values filled: ${rand(100, 4000)}`],
  [/load|write|publish|upload/, () => `Rows upserted: ${rand(40, 180) * 1000}\nCommit OK`],
  [/test|validate|check|lint/, () => `${rand(40, 260)} checks passed, 0 failed`],
  [/train|fit/, () => `epoch 10/10  loss=0.${rand(100, 400)}  acc=0.${rand(880, 970)}\nmodel saved to s3://models/latest`],
  [/eval|score/, () => `AUC=0.${rand(900, 980)}  F1=0.${rand(820, 930)}`],
  [/deploy|release|notify/, () => `Rolled out to ${rand(2, 8)} pods\nHealth checks green`],
  [/build|compile|package/, () => `Build finished in ${rand(20, 90)}s\nimage: registry.local/app:${uuid().slice(0, 7)}`],
];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function outputFor(name) {
  const match = TEMPLATE_OUTPUT.find(([re]) => re.test(name));
  return match ? match[1]() : `Task "${name}" completed successfully`;
}

const SEED_DEFINITIONS = [
  {
    name: 'etl-pipeline',
    tasks: [
      { name: 'extract', command: 'python extract.py --source=s3://events', timeoutSeconds: 120, maxRetries: 3, dependsOn: [] },
      { name: 'transform', command: 'python transform.py --in "$FLOWFORGE_UPSTREAM_EXTRACT"', timeoutSeconds: 60, maxRetries: 2, dependsOn: ['extract'] },
      { name: 'load', command: 'python load.py --target=warehouse', timeoutSeconds: 60, maxRetries: 2, dependsOn: ['transform'] },
    ],
  },
  {
    name: 'ml-training',
    tasks: [
      { name: 'fetch-dataset', command: 'dvc pull data/', timeoutSeconds: 120, maxRetries: 3, dependsOn: [] },
      { name: 'validate-schema', command: 'python checks/schema.py', timeoutSeconds: 30, maxRetries: 1, dependsOn: ['fetch-dataset'] },
      { name: 'feature-engineering', command: 'python features.py', timeoutSeconds: 90, maxRetries: 2, dependsOn: ['fetch-dataset'] },
      { name: 'train-model', command: 'python train.py --epochs 10', timeoutSeconds: 600, maxRetries: 1, dependsOn: ['validate-schema', 'feature-engineering'] },
      { name: 'evaluate', command: 'python eval.py', timeoutSeconds: 60, maxRetries: 1, dependsOn: ['train-model'] },
      { name: 'publish-report', command: 'python report.py', timeoutSeconds: 30, maxRetries: 2, dependsOn: ['evaluate'] },
    ],
  },
  {
    name: 'ci-release',
    tasks: [
      { name: 'build', command: 'docker build -t app .', timeoutSeconds: 300, maxRetries: 1, dependsOn: [] },
      { name: 'unit-tests', command: 'go test ./...', timeoutSeconds: 120, maxRetries: 2, dependsOn: ['build'] },
      { name: 'lint', command: 'golangci-lint run', timeoutSeconds: 60, maxRetries: 0, dependsOn: ['build'] },
      { name: 'integration-tests', command: 'make it', timeoutSeconds: 300, maxRetries: 2, dependsOn: ['build'] },
      { name: 'deploy', command: 'kubectl rollout restart deploy/app', timeoutSeconds: 120, maxRetries: 1, dependsOn: ['unit-tests', 'lint', 'integration-tests'] },
    ],
  },
];

export function createDemoApi() {
  const definitions = [];
  const runs = new Map(); // id -> run (full view shape, plus _plan per task)
  let timer = null;

  const nameCount = new Map();
  function addDefinition(payload, createdAt = Date.now()) {
    const version = (nameCount.get(payload.name) || 0) + 1;
    nameCount.set(payload.name, version);
    const def = {
      id: uuid(),
      name: payload.name,
      version,
      createdAt: iso(createdAt),
      tasks: payload.tasks.map((t) => ({
        name: t.name,
        command: t.command,
        dependsOn: t.dependsOn || [],
        timeoutSeconds: t.timeoutSeconds ?? 60,
        maxRetries: t.maxRetries ?? 3,
      })),
    };
    definitions.unshift(def);
    return def;
  }

  function newRun(def, startedAt = Date.now()) {
    const run = {
      id: uuid(),
      workflowDefinitionId: def.id,
      workflowName: def.name,
      workflowVersion: def.version,
      status: 'RUNNING',
      startedAt: iso(startedAt),
      completedAt: null,
      tasks: def.tasks.map((spec) => ({
        id: uuid(),
        taskName: spec.name,
        status: spec.dependsOn.length ? 'PENDING' : 'READY',
        dependsOn: spec.dependsOn,
        command: spec.command,
        attempt: 0,
        maxRetries: spec.maxRetries,
        timeoutSeconds: spec.timeoutSeconds,
        workerId: null,
        checkpointData: null,
        errorMessage: null,
        nextAttemptAt: iso(startedAt),
        startedAt: null,
        completedAt: null,
        _failures: plannedFailures(spec),
        _endsAt: null,
      })),
    };
    runs.set(run.id, run);
    return run;
  }

  // Most tasks succeed first time; some need a retry; rarely one exhausts its retries.
  function plannedFailures(spec) {
    const r = Math.random();
    if (r < 0.04) return spec.maxRetries + 1;
    if (r < 0.2) return 1;
    return 0;
  }

  const byName = (run) => new Map(run.tasks.map((t) => [t.taskName, t]));

  function promote(run) {
    const m = byName(run);
    for (const t of run.tasks) {
      if (t.status === 'PENDING' && t.dependsOn.every((d) => m.get(d)?.status === 'SUCCEEDED')) {
        t.status = 'READY';
      }
    }
  }

  function finalize(run, now) {
    if (run.status !== 'RUNNING') return;
    const terminal = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'];
    if (!run.tasks.every((t) => terminal.includes(t.status))) return;
    run.status = run.tasks.some((t) => t.status === 'FAILED') ? 'FAILED' : 'SUCCEEDED';
    run.completedAt = iso(now);
  }

  function busyWorkers() {
    const busy = new Set();
    for (const run of runs.values()) for (const t of run.tasks) if (t.status === 'RUNNING') busy.add(t.workerId);
    return busy;
  }

  function tick(now = Date.now()) {
    const busy = busyWorkers();
    for (const run of runs.values()) {
      if (run.status !== 'RUNNING') continue;

      for (const t of run.tasks) {
        if (t.status !== 'RUNNING' || now < t._endsAt) continue;
        busy.delete(t.workerId);
        if (t.attempt <= t._failures) {
          const willRetry = t.attempt < t.maxRetries;
          t.errorMessage = willRetry
            ? `exit status 1: connection reset by peer (attempt ${t.attempt})`
            : `exit status 1: ${t.taskName}: upstream service returned 503 (attempt ${t.attempt}, retries exhausted)`;
          if (willRetry) {
            t.status = 'READY';
            t.workerId = null;
            t.nextAttemptAt = iso(now + BACKOFF_MS * t.attempt);
          } else {
            t.status = 'FAILED';
            t.completedAt = iso(now);
            for (const o of run.tasks) if (o.status === 'PENDING' || o.status === 'READY') o.status = 'SKIPPED';
            run.status = 'FAILED';
            run.completedAt = iso(now);
          }
        } else {
          t.status = 'SUCCEEDED';
          t.errorMessage = null;
          t.checkpointData = outputFor(t.taskName);
          t.completedAt = iso(now);
          promote(run);
          finalize(run, now);
        }
      }

      for (const t of run.tasks) {
        if (run.status !== 'RUNNING') break;
        if (t.status !== 'READY' || new Date(t.nextAttemptAt).getTime() > now) continue;
        const worker = WORKERS.find((w) => !busy.has(w));
        if (!worker) break;
        busy.add(worker);
        t.status = 'RUNNING';
        t.workerId = worker;
        t.attempt += 1;
        t.startedAt = iso(now);
        t.completedAt = null;
        t._endsAt = now + rand(1100, 3400);
      }
    }
  }

  function seed() {
    const base = Date.now();
    const defs = SEED_DEFINITIONS.map((d, i) => addDefinition(d, base - (3 - i) * 3600_000));
    // Replay a few historical runs to completion instantly so the dashboard has history.
    const history = [defs[0], defs[1], defs[2], defs[0], defs[1], defs[0]];
    history.forEach((def, i) => {
      const start = base - (history.length - i) * 7 * 60_000;
      const run = newRun(def, start);
      let now = start;
      while (run.status === 'RUNNING' && now < start + 5 * 60_000) {
        tick(now);
        now += TICK_MS;
      }
    });
    newRun(defs[1]); // one live run so the graph is animating on first load
  }

  function ensureTimer() {
    if (!timer) timer = setInterval(() => tick(), TICK_MS);
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const publicRun = (run) => {
    const copy = clone(run);
    copy.tasks.forEach((t) => { delete t._failures; delete t._endsAt; });
    return copy;
  };
  const delay = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 120));
  const notFound = (what) => Promise.reject(new Error(`${what} not found`));

  seed();
  ensureTimer();

  return {
    mode: 'demo',
    ping: () => Promise.resolve(true),
    listDefinitions: () => delay(clone(definitions)),
    getDefinition: (id) => {
      const def = definitions.find((d) => d.id === id);
      return def ? delay(clone(def)) : notFound('Definition');
    },
    validate: (payload) => {
      const { levels, cyclic } = computeLevels(payload.tasks);
      if (cyclic.length) return Promise.reject(new Error(`Workflow definition contains a dependency cycle involving: ${cyclic.join(', ')}`));
      return delay({ valid: true, order: levels.flat(), levels });
    },
    registerDefinition: (payload) => {
      const def = addDefinition(payload);
      return delay({ id: def.id, name: def.name, version: def.version });
    },
    startRun: (definitionId) => {
      const def = definitions.find((d) => d.id === definitionId);
      if (!def) return notFound('Definition');
      const run = newRun(def);
      return delay(publicRun(run));
    },
    listRuns: ({ status, definitionId, limit = 50 } = {}) => {
      const list = [...runs.values()]
        .filter((r) => !status || r.status === status)
        .filter((r) => !definitionId || r.workflowDefinitionId === definitionId)
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .slice(0, limit)
        .map((r) => {
          const taskCounts = {};
          r.tasks.forEach((t) => { taskCounts[t.status] = (taskCounts[t.status] || 0) + 1; });
          const { tasks, ...rest } = r;
          return clone({ ...rest, totalTasks: tasks.length, taskCounts });
        });
      return delay(list);
    },
    getRun: (id) => (runs.has(id) ? delay(publicRun(runs.get(id))) : notFound('Run')),
    cancelRun: (id) => {
      const run = runs.get(id);
      if (!run) return notFound('Run');
      if (run.status !== 'RUNNING') return Promise.reject(new Error(`Run ${id} is already ${run.status}`));
      const now = Date.now();
      run.tasks.forEach((t) => {
        if (['PENDING', 'READY', 'RUNNING'].includes(t.status)) {
          t.status = 'CANCELLED';
          t.completedAt = iso(now);
        }
      });
      run.status = 'CANCELLED';
      run.completedAt = iso(now);
      return delay(publicRun(run));
    },
    retryRun: (id) => {
      const run = runs.get(id);
      if (!run) return notFound('Run');
      if (!['FAILED', 'CANCELLED'].includes(run.status)) {
        return Promise.reject(new Error(`Only FAILED or CANCELLED runs can be retried; run is ${run.status}`));
      }
      const now = Date.now();
      run.tasks.forEach((t) => {
        if (t.status === 'SUCCEEDED') return;
        Object.assign(t, {
          status: 'PENDING', attempt: 0, workerId: null, checkpointData: null, errorMessage: null,
          startedAt: null, completedAt: null, nextAttemptAt: iso(now), _failures: 0,
        });
      });
      run.status = 'RUNNING';
      run.completedAt = null;
      promote(run);
      return delay(publicRun(run));
    },
  };
}
