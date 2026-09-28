import { ArrowDownToLine, ArrowUpFromLine, Server, Terminal, Timer, X } from 'lucide-react';
import { StatusBadge } from './Status';
import CopyButton from './CopyButton';
import { duration, toEnvName } from '../lib/format';

function Field({ label, children }) {
  return (
    <div className="drawer-field">
      <div className="drawer-label">{label}</div>
      <div>{children}</div>
    </div>
  );
}

/** Slide-in inspector for a single task of a run. */
export default function TaskDrawer({ run, taskName, onClose, onSelect }) {
  const task = run.tasks.find((t) => t.taskName === taskName);
  if (!task) return null;
  const downstream = run.tasks.filter((t) => (t.dependsOn || []).includes(task.taskName));
  const upstream = (task.dependsOn || []).map((d) => run.tasks.find((t) => t.taskName === d)).filter(Boolean);

  return (
    <aside className="drawer" aria-label={`Task ${task.taskName}`}>
      <div className="drawer-header">
        <div className="drawer-title">
          <Terminal size={16} />
          <span className="mono">{task.taskName}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close task panel">
          <X size={18} />
        </button>
      </div>

      <div className="drawer-body">
        <div className="drawer-grid">
          <Field label="Status">
            <StatusBadge status={task.status} />
          </Field>
          <Field label="Attempt">
            <span className="mono">
              {task.attempt} / {task.maxRetries}
            </span>
          </Field>
          <Field label="Duration">
            <span className="mono">
              <Timer size={12} /> {duration(task.startedAt, task.completedAt)}
            </span>
          </Field>
          <Field label="Timeout">
            <span className="mono">{task.timeoutSeconds ? `${task.timeoutSeconds}s` : '—'}</span>
          </Field>
          <Field label="Worker">
            <span className="mono">
              <Server size={12} /> {task.workerId || '—'}
            </span>
          </Field>
          {task.status === 'READY' && task.attempt > 0 && task.nextAttemptAt && (
            <Field label="Next attempt">
              <span className="mono">{new Date(task.nextAttemptAt).toLocaleTimeString()}</span>
            </Field>
          )}
        </div>

        {task.command && (
          <Field label="Command">
            <div className="code-block">
              <code>{task.command}</code>
              <CopyButton text={task.command} className="btn btn-ghost btn-icon code-copy" />
            </div>
          </Field>
        )}

        {(upstream.length > 0 || downstream.length > 0) && (
          <div className="drawer-deps">
            {upstream.length > 0 && (
              <Field label="Reads from">
                <div className="chip-row">
                  {upstream.map((u) => (
                    <button key={u.id} type="button" className={`chip chip-${u.status}`} onClick={() => onSelect(u.taskName)}>
                      <ArrowDownToLine size={11} /> {u.taskName}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {downstream.length > 0 && (
              <Field label="Feeds into">
                <div className="chip-row">
                  {downstream.map((d) => (
                    <button key={d.id} type="button" className={`chip chip-${d.status}`} onClick={() => onSelect(d.taskName)}>
                      <ArrowUpFromLine size={11} /> {d.taskName}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
        )}

        {task.errorMessage && (
          <Field label={task.status === 'FAILED' ? 'Error' : 'Last error'}>
            <pre className="terminal terminal-error">{task.errorMessage}</pre>
          </Field>
        )}

        <Field label="Output (checkpoint)">
          {task.checkpointData ? (
            <div className="code-block">
              <pre className="terminal terminal-ok">{task.checkpointData}</pre>
              <CopyButton text={task.checkpointData} className="btn btn-ghost btn-icon code-copy" />
            </div>
          ) : (
            <pre className="terminal terminal-muted">
              {task.status === 'RUNNING' ? 'Running… output is recorded when the task finishes.' : 'No output recorded.'}
            </pre>
          )}
        </Field>

        {downstream.length > 0 && (
          <div className="hint">
            Downstream tasks can read this output as <code>${`FLOWFORGE_UPSTREAM_${toEnvName(task.taskName)}`}</code>.
          </div>
        )}
      </div>
    </aside>
  );
}
