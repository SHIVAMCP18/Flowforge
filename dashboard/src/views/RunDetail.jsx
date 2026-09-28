import { useState } from 'react';
import { ArrowLeft, Ban, GanttChart, GitCommit, LayoutList, RotateCcw, Workflow } from 'lucide-react';
import DagGraph from '../components/DagGraph';
import Timeline from '../components/Timeline';
import TaskDrawer from '../components/TaskDrawer';
import CopyButton from '../components/CopyButton';
import { StatusBadge, TaskProgress } from '../components/Status';
import { countStatuses, duration, TERMINAL_RUN } from '../lib/format';
import { displayBase } from '../lib/api';
import { useNow, usePolling } from '../lib/hooks';

export default function RunDetail({ api, runId, navigate, toast }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('graph');
  const [busy, setBusy] = useState(false);

  const active = !run || !TERMINAL_RUN.has(run.status);
  usePolling(
    async (isStale) => {
      try {
        const data = await api.getRun(runId);
        if (!isStale()) {
          setRun(data);
          setError(null);
        }
      } catch (e) {
        if (!isStale()) setError(e.message);
      }
    },
    1000,
    [api, runId],
    active,
  );
  const now = useNow(250, run?.status === 'RUNNING');

  if (error && !run) {
    return (
      <div className="empty-state">
        <div className="empty-title">Run not found</div>
        <p className="muted">{error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>
          <ArrowLeft size={14} /> Back to dashboard
        </button>
      </div>
    );
  }
  if (!run) return <div className="skeleton skeleton-block" />;

  const counts = countStatuses(run.tasks);
  const act = async (fn, verb) => {
    setBusy(true);
    try {
      setRun(await fn(run.id));
      toast(`Run ${verb}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const curl = `curl ${displayBase()}/api/workflows/runs/${run.id}`;

  return (
    <div className={`with-drawer ${selected ? 'drawer-open' : ''}`}>
      <div className="with-drawer-main">
        <div className="page-header">
          <div>
            <div className="breadcrumb">
              <button type="button" onClick={() => navigate('/')}>Dashboard</button>
              <span>/</span>
              <button type="button" onClick={() => navigate(`/definitions/${run.workflowDefinitionId}`)}>
                {run.workflowName} v{run.workflowVersion}
              </button>
              <span>/</span>
              <span className="breadcrumb-current">Run</span>
            </div>
            <div className="title-row">
              <h1 className="page-title mono run-id">{run.id}</h1>
              <CopyButton text={run.id} className="btn btn-ghost btn-icon" onCopied={() => toast('Run ID copied', 'success')} />
            </div>
            <p className="page-subtitle">
              Started {new Date(run.startedAt).toLocaleString()} · {duration(run.startedAt, run.completedAt)}
            </p>
          </div>
          <div className="page-actions">
            <StatusBadge status={run.status} large />
            {run.status === 'RUNNING' && (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => act(api.cancelRun, 'cancelled')}>
                <Ban size={15} /> Cancel
              </button>
            )}
            {(run.status === 'FAILED' || run.status === 'CANCELLED') && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(api.retryRun, 'resumed from last checkpoint')}>
                <RotateCcw size={15} /> Resume run
              </button>
            )}
            <CopyButton text={curl} label="curl" className="btn btn-secondary" onCopied={() => toast('curl command copied', 'success')} />
          </div>
        </div>

        <div className="run-progress card">
          <div className="run-progress-head">
            <span>
              {counts.SUCCEEDED || 0} of {run.tasks.length} tasks succeeded
            </span>
            <span className="legend">
              {Object.entries(counts).map(([s, n]) => (
                <span key={s} className={`legend-item legend-${s}`}>
                  {n} {s.toLowerCase()}
                </span>
              ))}
            </span>
          </div>
          <TaskProgress counts={counts} total={run.tasks.length} height={8} />
        </div>

        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <GitCommit size={18} /> Execution
            </div>
            <div className="segmented">
              <button type="button" className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>
                <Workflow size={13} /> Graph
              </button>
              <button type="button" className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>
                <GanttChart size={13} /> Timeline
              </button>
            </div>
          </div>
          <div className="card-body tight">
            {view === 'graph' ? (
              <DagGraph tasks={run.tasks} selected={selected} onSelect={setSelected} />
            ) : (
              <Timeline run={run} now={now} selected={selected} onSelect={setSelected} />
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <LayoutList size={18} /> Tasks
            </div>
            <span className="muted small">Click a task to inspect its output</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th className="hide-sm">Depends on</th>
                  <th className="hide-sm">Worker</th>
                  <th>Attempt</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {run.tasks.map((task) => (
                  <tr
                    key={task.id}
                    className={`clickable ${selected === task.taskName ? 'row-selected' : ''}`}
                    onClick={() => setSelected(task.taskName)}
                  >
                    <td className="mono cell-title">{task.taskName}</td>
                    <td>
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="hide-sm mono muted">{(task.dependsOn || []).join(', ') || '—'}</td>
                    <td className="hide-sm mono muted">{task.workerId || '—'}</td>
                    <td className="mono">
                      {task.attempt}/{task.maxRetries}
                    </td>
                    <td className="mono">{duration(task.startedAt, task.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selected && <TaskDrawer run={run} taskName={selected} onClose={() => setSelected(null)} onSelect={setSelected} />}
    </div>
  );
}
