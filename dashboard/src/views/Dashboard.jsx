import { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock, GitBranch, Layers, Play, Plus, Search, Workflow } from 'lucide-react';
import AnimatedNumber from '../components/AnimatedNumber';
import { StatusBadge, TaskProgress } from '../components/Status';
import { durationMs, formatDuration, shortId, timeAgo } from '../lib/format';
import { computeLevels } from '../lib/dag';
import { useNow, usePolling } from '../lib/hooks';

const FILTERS = ['ALL', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'];

export default function Dashboard({ api, navigate, toast, onStartRun }) {
  const [definitions, setDefinitions] = useState(null);
  const [runs, setRuns] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [live, setLive] = useState(true);

  usePolling(
    async (isStale) => {
      try {
        const [defs, recent] = await Promise.all([api.listDefinitions(), api.listRuns({ limit: 100 })]);
        if (isStale()) return;
        setDefinitions(defs);
        setRuns(recent);
      } catch (e) {
        if (!isStale()) toast(`Could not refresh: ${e.message}`, 'error');
      }
    },
    2000,
    [api],
    live,
  );
  const anyRunning = runs?.some((r) => r.status === 'RUNNING');
  useNow(1000, anyRunning);

  const metrics = useMemo(() => {
    const list = runs || [];
    const finished = list.filter((r) => r.status === 'SUCCEEDED' || r.status === 'FAILED');
    const succeeded = list.filter((r) => r.status === 'SUCCEEDED');
    const avg = succeeded.length
      ? succeeded.reduce((s, r) => s + durationMs(r.startedAt, r.completedAt), 0) / succeeded.length
      : null;
    return {
      total: list.length,
      successRate: finished.length ? (succeeded.length / finished.length) * 100 : 0,
      running: list.filter((r) => r.status === 'RUNNING').length,
      avgMs: avg,
    };
  }, [runs]);

  const visibleRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (runs || []).filter(
      (r) =>
        (filter === 'ALL' || r.status === filter) &&
        (!q || r.id.toLowerCase().includes(q) || (r.workflowName || '').toLowerCase().includes(q)),
    );
  }, [runs, filter, query]);

  const loading = runs === null || definitions === null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Operations Center</h1>
          <p className="page-subtitle">Live view of workflow definitions and executions</p>
        </div>
        <div className="page-actions">
          <button type="button" className={`btn btn-sm ${live ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setLive(!live)}>
            <span className={`live-dot ${live ? 'on' : ''}`} />
            {live ? 'Live' : 'Paused'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/builder')}>
            <Plus size={16} /> New workflow <kbd>N</kbd>
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <MetricCard label="Executions" icon={Layers} loading={loading}>
          <AnimatedNumber value={metrics.total} />
        </MetricCard>
        <MetricCard label="Success rate" icon={CheckCircle2} tone="success" loading={loading}>
          <AnimatedNumber value={metrics.successRate} suffix="%" />
          <div className="metric-bar">
            <div className="metric-bar-fill" style={{ width: `${metrics.successRate}%` }} />
          </div>
        </MetricCard>
        <MetricCard label="Active runs" icon={Activity} tone="accent" loading={loading} pulse={metrics.running > 0}>
          <AnimatedNumber value={metrics.running} />
        </MetricCard>
        <MetricCard label="Avg duration" icon={Clock} loading={loading}>
          {formatDuration(metrics.avgMs)}
        </MetricCard>
      </div>

      {runs && runs.length > 0 && (
        <div className="activity-strip" aria-label="Recent run outcomes">
          {[...runs].slice(0, 60).reverse().map((r, i) => (
            <button
              type="button"
              key={r.id}
              className={`activity-cell cell-${r.status}`}
              style={{ animationDelay: `${i * 12}ms` }}
              title={`${r.workflowName} · ${r.status} · ${timeAgo(r.startedAt)}`}
              onClick={() => navigate(`/runs/${r.id}`)}
            />
          ))}
        </div>
      )}

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <Workflow size={18} /> Workflows
            </div>
            <span className="muted small">{definitions?.length ?? 0} definitions</span>
          </div>
          {loading ? (
            <SkeletonRows />
          ) : definitions.length === 0 ? (
            <div className="empty-state">
              <GitBranch className="empty-icon" size={32} />
              <div className="empty-title">No workflows yet</div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/builder')}>
                <Plus size={14} /> Create your first workflow
              </button>
            </div>
          ) : (
            <ul className="def-list">
              {latestVersions(definitions).map((def, i) => {
                const levels = computeLevels(def.tasks || []).levels.length;
                return (
                  <li key={def.id} className="def-item fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                    <button type="button" className="def-main" onClick={() => navigate(`/definitions/${def.id}`)}>
                      <span className="def-name">{def.name}</span>
                      <span className="def-meta">
                        v{def.version} · {def.tasks?.length ?? 0} tasks · {levels} stages
                      </span>
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onStartRun(def.id)}>
                      <Play size={13} /> Run
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-header wrap">
            <div className="card-title">
              <Activity size={18} /> Executions
            </div>
            <div className="toolbar">
              <div className="segmented">
                {FILTERS.map((f) => (
                  <button type="button" key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                    {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              <div className="search">
                <Search size={14} />
                <input
                  id="run-search"
                  placeholder="Search runs…  /"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
          </div>
          {loading ? (
            <SkeletonRows />
          ) : visibleRuns.length === 0 ? (
            <div className="empty-state">
              <Activity className="empty-icon" size={32} />
              <div className="empty-title">{runs.length === 0 ? 'No executions yet' : 'No matching runs'}</div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th className="hide-sm">Progress</th>
                    <th>Duration</th>
                    <th className="hide-sm">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRuns.map((run) => (
                    <tr key={run.id} className="clickable row-in" onClick={() => navigate(`/runs/${run.id}`)}>
                      <td>
                        <div className="cell-title">{run.workflowName || 'unknown'}</div>
                        <div className="cell-sub mono">
                          {shortId(run.id)} · v{run.workflowVersion}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="hide-sm" style={{ minWidth: 120 }}>
                        <TaskProgress counts={run.taskCounts} total={run.totalTasks} />
                        <div className="cell-sub">
                          {run.taskCounts?.SUCCEEDED || 0}/{run.totalTasks} tasks
                        </div>
                      </td>
                      <td className="mono">{formatDuration(durationMs(run.startedAt, run.completedAt))}</td>
                      <td className="hide-sm muted">{timeAgo(run.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function latestVersions(definitions) {
  const seen = new Map();
  for (const d of definitions) {
    const prev = seen.get(d.name);
    if (!prev || d.version > prev.version) seen.set(d.name, d);
  }
  return [...seen.values()];
}

function MetricCard({ label, icon: Icon, tone, children, loading, pulse }) {
  return (
    <div className={`metric-card ${tone ? `tone-${tone}` : ''} ${pulse ? 'pulse' : ''}`}>
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <Icon size={18} />
      </div>
      <div className="metric-value">{loading ? <span className="skeleton skeleton-text" /> : children}</div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="skeleton-rows">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton skeleton-row" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}
