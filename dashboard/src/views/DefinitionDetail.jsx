import { useState } from 'react';
import { Activity, Braces, Code, GitBranch, Pencil, Play, Workflow } from 'lucide-react';
import DagGraph from '../components/DagGraph';
import CopyButton from '../components/CopyButton';
import { StatusBadge, TaskProgress } from '../components/Status';
import { computeLevels } from '../lib/dag';
import { durationMs, formatDuration, shortId, timeAgo } from '../lib/format';
import { displayBase } from '../lib/api';
import { usePolling } from '../lib/hooks';

export default function DefinitionDetail({ api, definitionId, navigate, toast, onStartRun, onEdit }) {
  const [def, setDef] = useState(null);
  const [versions, setVersions] = useState([]);
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('graph');

  usePolling(
    async (isStale) => {
      try {
        const [d, r, all] = await Promise.all([
          api.getDefinition(definitionId),
          api.listRuns({ definitionId, limit: 20 }),
          api.listDefinitions(),
        ]);
        if (isStale()) return;
        setDef(d);
        setRuns(r);
        setVersions(all.filter((x) => x.name === d.name).sort((a, b) => b.version - a.version));
      } catch (e) {
        if (!isStale()) setError(e.message);
      }
    },
    3000,
    [api, definitionId],
  );

  if (error && !def) {
    return (
      <div className="empty-state">
        <div className="empty-title">Definition not found</div>
        <p className="muted">{error}</p>
      </div>
    );
  }
  if (!def) return <div className="skeleton skeleton-block" />;

  const levels = computeLevels(def.tasks).levels;
  const payload = { name: def.name, tasks: def.tasks };
  const runCurl = `curl -X POST ${displayBase()}/api/workflows/${def.id}/runs`;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <button type="button" onClick={() => navigate('/')}>Dashboard</button>
            <span>/</span>
            <span className="breadcrumb-current">Definition</span>
          </div>
          <h1 className="page-title mono">{def.name}</h1>
          <p className="page-subtitle">
            Version {def.version} · {def.tasks.length} tasks · {levels.length} stages · registered {timeAgo(def.createdAt)}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onEdit(payload)}>
            <Pencil size={15} /> Edit as new version
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onStartRun(def.id)}>
            <Play size={15} /> Run now
          </button>
        </div>
      </div>

      {versions.length > 1 && (
        <div className="version-row">
          <GitBranch size={14} />
          {versions.map((v) => (
            <button
              type="button"
              key={v.id}
              className={`chip ${v.id === def.id ? 'on' : ''}`}
              onClick={() => navigate(`/definitions/${v.id}`)}
            >
              v{v.version}
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <div className="segmented">
            <button type="button" className={tab === 'graph' ? 'active' : ''} onClick={() => setTab('graph')}>
              <Workflow size={13} /> Graph
            </button>
            <button type="button" className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>
              <Braces size={13} /> JSON
            </button>
          </div>
          <div className="toolbar">
            <CopyButton text={def.id} label="ID" onCopied={() => toast('Definition ID copied', 'success')} />
            <CopyButton text={runCurl} label="curl run" onCopied={() => toast('curl command copied', 'success')} />
          </div>
        </div>
        <div className="card-body tight">
          {tab === 'graph' ? (
            <>
              <DagGraph tasks={def.tasks} />
              <ol className="plan plan-inline">
                {levels.map((level, i) => (
                  <li key={i}>
                    <span className="plan-stage">Stage {i + 1}</span>
                    <span className="mono">{level.join(' · ')}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="code-block">
              <pre className="code-preview tall">{JSON.stringify(payload, null, 2)}</pre>
              <CopyButton text={JSON.stringify(payload, null, 2)} className="btn btn-ghost btn-icon code-copy" />
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div className="card-title">
            <Code size={18} /> Tasks
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Command</th>
                <th className="hide-sm">Depends on</th>
                <th>Timeout</th>
                <th>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {def.tasks.map((t) => (
                <tr key={t.name}>
                  <td className="mono cell-title">{t.name}</td>
                  <td className="mono muted truncate" title={t.command}>{t.command}</td>
                  <td className="hide-sm mono muted">{t.dependsOn?.join(', ') || '—'}</td>
                  <td className="mono">{t.timeoutSeconds ?? 'default'}{t.timeoutSeconds ? 's' : ''}</td>
                  <td className="mono">{t.maxRetries ?? 'default'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div className="card-title">
            <Activity size={18} /> Recent runs of this version
          </div>
        </div>
        {!runs || runs.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-title">No runs yet</div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onStartRun(def.id)}>
              <Play size={13} /> Run it
            </button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/runs/${r.id}`)}>
                    <td className="mono">{shortId(r.id)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <TaskProgress counts={r.taskCounts} total={r.totalTasks} />
                    </td>
                    <td className="mono">{formatDuration(durationMs(r.startedAt, r.completedAt))}</td>
                    <td className="muted hide-sm">{timeAgo(r.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
