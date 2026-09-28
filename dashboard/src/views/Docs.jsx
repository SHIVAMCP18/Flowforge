import { BookOpen, Terminal } from 'lucide-react';
import CopyButton from '../components/CopyButton';
import { displayBase } from '../lib/api';

const ENV_VARS = [
  ['FLOWFORGE_RUN_ID', 'ID of the workflow run'],
  ['FLOWFORGE_TASK_RUN_ID', 'ID of this task execution'],
  ['FLOWFORGE_TASK_NAME', 'Name of the task'],
  ['FLOWFORGE_ATTEMPT', 'Attempt number, starting at 1 — handy for idempotency and retry logic'],
  ['FLOWFORGE_WORKER_ID', 'Worker slot executing the task'],
  ['FLOWFORGE_UPSTREAM_<TASK>', 'Output of a dependency, e.g. FLOWFORGE_UPSTREAM_FETCH_DATA for "fetch-data"'],
  ['FLOWFORGE_UPSTREAM_JSON', 'All dependency outputs as a JSON object keyed by task name'],
];

function Snippet({ title, code, toast }) {
  return (
    <div className="snippet">
      <div className="snippet-head">
        <span>{title}</span>
        <CopyButton text={code} onCopied={() => toast('Copied', 'success')} />
      </div>
      <pre className="code-preview">{code}</pre>
    </div>
  );
}

export default function Docs({ toast }) {
  const base = displayBase();
  const endpoints = [
    ['GET', '/api/workflows', 'List definitions (all versions)'],
    ['POST', '/api/workflows', 'Register a definition; same name → next version'],
    ['POST', '/api/workflows/validate', 'Dry-run validation, returns the execution plan'],
    ['GET', '/api/workflows/{id}', 'Get one definition'],
    ['POST', '/api/workflows/{id}/runs', 'Start a run'],
    ['GET', '/api/workflows/runs?status=&definitionId=&limit=', 'List recent runs with task counts'],
    ['GET', '/api/workflows/runs/{runId}', 'Run with per-task status, output and errors'],
    ['POST', '/api/workflows/runs/{runId}/cancel', 'Cancel a running run'],
    ['POST', '/api/workflows/runs/{runId}/retry', 'Resume a failed/cancelled run from its checkpoints'],
    ['POST', '/api/workers/{workerId}/lease', 'Worker: lease the next READY task (204 = no work)'],
    ['POST', '/api/tasks/{taskRunId}/complete', 'Worker: report success + checkpoint (409 if lease lost)'],
    ['POST', '/api/tasks/{taskRunId}/fail', 'Worker: report failure (409 if lease lost)'],
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Developer guide</h1>
          <p className="page-subtitle">Everything you need to drive FlowForge from scripts, CI, or your own services.</p>
        </div>
      </div>

      <div className="docs-grid">
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <Terminal size={18} /> Quickstart
            </div>
          </div>
          <div className="card-body">
            <Snippet
              toast={toast}
              title="1 · Start the stack"
              code={`docker compose up --build --scale worker=3\ncd dashboard && npm install && npm run dev`}
            />
            <Snippet
              toast={toast}
              title="2 · Register a workflow"
              code={`curl -X POST ${base}/api/workflows \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"hello","tasks":[\n    {"name":"greet","command":"echo hello"},\n    {"name":"shout","dependsOn":["greet"],"command":"echo $FLOWFORGE_UPSTREAM_GREET | tr a-z A-Z"}\n  ]}'`}
            />
            <Snippet toast={toast} title="3 · Run it and watch" code={`curl -X POST ${base}/api/workflows/<definitionId>/runs\ncurl ${base}/api/workflows/runs/<runId>`} />
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <BookOpen size={18} /> Task environment
            </div>
          </div>
          <div className="card-body">
            <p className="muted">Every command runs under <code>sh -c</code> with these variables set by the worker:</p>
            <table className="kv-table">
              <tbody>
                {ENV_VARS.map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td className="muted">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Stdout + stderr (up to 4 KB) become the task&apos;s checkpoint. A non-zero exit or exceeding
              <code> timeoutSeconds</code> fails the attempt; it is retried with linear backoff until <code>maxRetries</code>{' '}
              attempts are used, then downstream tasks are skipped.
            </p>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <div className="card-title">REST API</div>
          <span className="muted small mono">{base}</span>
        </div>
        <div className="table-wrapper">
          <table>
            <tbody>
              {endpoints.map(([m, p, d]) => (
                <tr key={m + p}>
                  <td>
                    <span className={`method method-${m}`}>{m}</span>
                  </td>
                  <td className="mono">{p}</td>
                  <td className="muted hide-sm">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
