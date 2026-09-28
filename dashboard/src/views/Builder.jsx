import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Braces, CheckCircle2, Copy, Download, LayoutList, Play, Plus, Save, ShieldCheck, Trash2, Upload, Workflow,
} from 'lucide-react';
import DagGraph from '../components/DagGraph';
import CopyButton from '../components/CopyButton';
import { validateDag } from '../lib/dag';
import { shellQuote, toEnvName } from '../lib/format';
import { displayBase } from '../lib/api';

const DRAFT_KEY = 'flowforge.builderDraft';

let uidSeq = 0;
const uid = () => `t${Date.now().toString(36)}${(uidSeq++).toString(36)}`;
const task = (name, command, dependsOn = [], extra = {}) => ({
  uid: uid(), name, command, dependsOn, timeoutSeconds: 60, maxRetries: 3, ...extra,
});

const TEMPLATES = {
  etl: {
    label: 'ETL pipeline',
    description: 'extract → transform → load',
    build: () => ({
      name: 'etl-pipeline',
      tasks: [
        task('extract', 'echo "rows=1200"'),
        task('transform', 'echo "cleaned $FLOWFORGE_UPSTREAM_EXTRACT"', ['extract']),
        task('load', 'echo "loaded: $FLOWFORGE_UPSTREAM_TRANSFORM"', ['transform'], { maxRetries: 2 }),
      ],
    }),
  },
  fanout: {
    label: 'Fan-out / fan-in',
    description: 'one task feeds three parallel tasks, then a join',
    build: () => ({
      name: 'parallel-report',
      tasks: [
        task('fetch', 'echo "dataset ready"'),
        task('stats-eu', 'sleep 1 && echo "eu ok"', ['fetch']),
        task('stats-us', 'sleep 2 && echo "us ok"', ['fetch']),
        task('stats-apac', 'sleep 1 && echo "apac ok"', ['fetch']),
        task('merge', 'echo "$FLOWFORGE_UPSTREAM_JSON"', ['stats-eu', 'stats-us', 'stats-apac']),
      ],
    }),
  },
  ml: {
    label: 'ML training',
    description: 'data prep branches that join before training',
    build: () => ({
      name: 'ml-training',
      tasks: [
        task('fetch-dataset', 'echo "10k samples"'),
        task('validate-schema', 'echo "schema ok"', ['fetch-dataset'], { maxRetries: 1 }),
        task('features', 'echo "42 features"', ['fetch-dataset']),
        task('train', 'sleep 2 && echo "acc=0.93"', ['validate-schema', 'features'], { timeoutSeconds: 600, maxRetries: 1 }),
        task('evaluate', 'echo "AUC=0.95"', ['train']),
      ],
    }),
  },
  flaky: {
    label: 'Retry demo',
    description: 'a task that fails once, then succeeds on retry',
    build: () => ({
      name: 'retry-demo',
      tasks: [
        task('prepare', 'echo ready'),
        task(
          'flaky-call',
          'if [ "$FLOWFORGE_ATTEMPT" -lt 2 ]; then echo "503 from upstream" >&2; exit 1; fi; echo "succeeded on attempt $FLOWFORGE_ATTEMPT"',
          ['prepare'],
          { maxRetries: 3 },
        ),
        task('report', 'echo "done: $FLOWFORGE_UPSTREAM_FLAKY_CALL"', ['flaky-call']),
      ],
    }),
  },
  blank: {
    label: 'Blank',
    description: 'start from a single task',
    build: () => ({ name: 'my-workflow', tasks: [task('first-task', 'echo "hello from FlowForge"')] }),
  },
};

/** Converts a payload from the API/JSON into editable builder state. */
function fromPayload(payload) {
  return {
    name: payload.name || 'my-workflow',
    tasks: (payload.tasks || []).map((t) => ({
      uid: uid(),
      name: t.name || '',
      command: t.command || '',
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      timeoutSeconds: t.timeoutSeconds ?? 60,
      maxRetries: t.maxRetries ?? 3,
    })),
  };
}

function toPayload(state) {
  return {
    name: state.name.trim(),
    tasks: state.tasks.map((t) => ({
      name: t.name.trim(),
      command: t.command,
      dependsOn: t.dependsOn,
      timeoutSeconds: Number(t.timeoutSeconds),
      maxRetries: Number(t.maxRetries),
    })),
  };
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? fromPayload(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export default function Builder({ api, navigate, toast, initial, onStartRun }) {
  const [state, setState] = useState(() => (initial ? fromPayload(initial) : loadDraft() || TEMPLATES.etl.build()));
  const [mode, setMode] = useState('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [serverCheck, setServerCheck] = useState(null);
  const fileRef = useRef(null);

  const payload = useMemo(() => toPayload(state), [state]);
  const validation = useMemo(() => validateDag(state.tasks), [state.tasks]);
  const nameError = !state.name.trim() ? 'Workflow name is required' : null;
  const canSubmit = validation.valid && !nameError && !busy;
  const invalidNames = [
    ...new Set(validation.errors.filter((e) => e.task != null).map((e) => state.tasks[e.task]?.name).concat(validation.cyclic)),
  ];

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      /* storage unavailable */
    }
  }, [payload]);
  // A server check only applies to the exact payload it was run against.
  const payloadKey = JSON.stringify(payload);
  const serverResult = serverCheck?.key === payloadKey ? serverCheck : null;

  const updateTask = (id, patch) =>
    setState((s) => {
      const current = s.tasks.find((t) => t.uid === id);
      let tasks = s.tasks.map((t) => (t.uid === id ? { ...t, ...patch } : t));
      // Renaming a task keeps every dependency on it pointing at the new name.
      if (patch.name !== undefined && current && current.name && patch.name !== current.name) {
        tasks = tasks.map((t) => ({ ...t, dependsOn: t.dependsOn.map((d) => (d === current.name ? patch.name : d)) }));
      }
      return { ...s, tasks };
    });

  const toggleDep = (id, dep) =>
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.uid !== id ? t : { ...t, dependsOn: t.dependsOn.includes(dep) ? t.dependsOn.filter((d) => d !== dep) : [...t.dependsOn, dep] },
      ),
    }));

  const addTask = () =>
    setState((s) => {
      const taken = new Set(s.tasks.map((t) => t.name));
      let n = s.tasks.length + 1;
      while (taken.has(`task-${n}`)) n += 1;
      const last = s.tasks[s.tasks.length - 1];
      return { ...s, tasks: [...s.tasks, task(`task-${n}`, 'echo "processing"', last ? [last.name] : [])] };
    });

  const duplicateTask = (id) =>
    setState((s) => {
      const i = s.tasks.findIndex((t) => t.uid === id);
      const src = s.tasks[i];
      const taken = new Set(s.tasks.map((t) => t.name));
      let name = `${src.name}-copy`;
      for (let k = 2; taken.has(name); k += 1) name = `${src.name}-copy-${k}`;
      const tasks = [...s.tasks];
      tasks.splice(i + 1, 0, { ...src, uid: uid(), name, dependsOn: [...src.dependsOn] });
      return { ...s, tasks };
    });

  const removeTask = (id) =>
    setState((s) => {
      const removed = s.tasks.find((t) => t.uid === id);
      return {
        ...s,
        tasks: s.tasks.filter((t) => t.uid !== id).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== removed?.name) })),
      };
    });

  const applyTemplate = (key) => {
    setState(TEMPLATES[key].build());
    setMode('form');
    toast(`Loaded "${TEMPLATES[key].label}" template`, 'info');
  };

  const openJson = () => {
    setJsonText(JSON.stringify(payload, null, 2));
    setJsonError(null);
    setMode('json');
  };

  const onJsonChange = (text) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.tasks)) throw new Error('"tasks" must be an array');
      setState(fromPayload(parsed));
      setJsonError(null);
    } catch (e) {
      setJsonError(e.message);
    }
  };

  const importFile = async (file) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      setState(fromPayload(parsed));
      setMode('form');
      toast(`Imported ${file.name}`, 'success');
    } catch (e) {
      toast(`Could not import ${file.name}: ${e.message}`, 'error');
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${payload.name || 'workflow'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const checkOnServer = async () => {
    try {
      const res = await api.validate(payload);
      setServerCheck({ key: payloadKey, ok: true, levels: res.levels });
    } catch (e) {
      setServerCheck({ key: payloadKey, ok: false, message: e.message });
    }
  };

  const register = async (andRun) => {
    setBusy(true);
    try {
      const def = await api.registerDefinition(payload);
      toast(`Registered "${def.name}" v${def.version}`, 'success');
      if (andRun) await onStartRun(def.id);
      else navigate(`/definitions/${def.id}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const curl = `curl -X POST ${displayBase()}/api/workflows \\\n  -H 'Content-Type: application/json' \\\n  -d ${shellQuote(JSON.stringify(payload))}`;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <button type="button" onClick={() => navigate('/')}>Dashboard</button>
            <span>/</span>
            <span className="breadcrumb-current">Workflow builder</span>
          </div>
          <h1 className="page-title">Define a workflow</h1>
          <p className="page-subtitle">Tasks run as shell commands on the worker pool. Dependencies decide the order.</p>
        </div>
        <div className="page-actions">
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Import
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={download}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <div className="template-row">
        {Object.entries(TEMPLATES).map(([key, t]) => (
          <button type="button" key={key} className="template-card" onClick={() => applyTemplate(key)}>
            <span className="template-name">{t.label}</span>
            <span className="template-desc">{t.description}</span>
          </button>
        ))}
      </div>

      <div className="builder-layout">
        <section className="card">
          <div className="card-header">
            <div className="segmented">
              <button type="button" className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>
                <LayoutList size={13} /> Form
              </button>
              <button type="button" className={mode === 'json' ? 'active' : ''} onClick={openJson}>
                <Braces size={13} /> JSON
              </button>
            </div>
            {mode === 'form' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={addTask}>
                <Plus size={14} /> Add task
              </button>
            )}
          </div>

          <div className="card-body">
            <div className="form-group">
              <label className="form-label" htmlFor="wf-name">Workflow name</label>
              <input
                id="wf-name"
                className={`form-input mono ${nameError ? 'input-error' : ''}`}
                value={state.name}
                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              />
              <p className="form-help">Registering an existing name creates a new version.</p>
            </div>

            {mode === 'json' ? (
              <div className="form-group">
                <label className="form-label" htmlFor="wf-json">Definition JSON</label>
                <textarea
                  id="wf-json"
                  className={`form-input mono json-editor ${jsonError ? 'input-error' : ''}`}
                  spellCheck={false}
                  value={jsonText}
                  onChange={(e) => onJsonChange(e.target.value)}
                />
                {jsonError ? <p className="form-error">{jsonError}</p> : <p className="form-help">Edits apply live to the graph preview.</p>}
              </div>
            ) : (
              <div className="task-list">
                {state.tasks.map((t, idx) => {
                  const others = state.tasks.filter((o) => o.uid !== t.uid && o.name);
                  const bad = invalidNames.includes(t.name);
                  return (
                    <div key={t.uid} className={`task-item ${bad ? 'task-item-error' : ''}`} style={{ animationDelay: `${idx * 30}ms` }}>
                      <div className="task-item-header">
                        <div className="task-item-title">
                          <span className="task-index">{idx + 1}</span>
                          <input
                            className="task-name-input mono"
                            value={t.name}
                            aria-label="Task name"
                            onChange={(e) => updateTask(t.uid, { name: e.target.value })}
                          />
                        </div>
                        <div className="task-item-actions">
                          <button type="button" className="btn btn-ghost btn-icon" title="Duplicate" onClick={() => duplicateTask(t.uid)}>
                            <Copy size={14} />
                          </button>
                          <button type="button" className="btn btn-ghost btn-icon danger" title="Delete" onClick={() => removeTask(t.uid)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="task-item-body">
                        <div className="col-span-2">
                          <label className="form-label">Command</label>
                          <textarea
                            className="form-input mono command-input"
                            rows={Math.min(4, Math.max(1, t.command.split('\n').length))}
                            value={t.command}
                            onChange={(e) => updateTask(t.uid, { command: e.target.value })}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="form-label">Depends on</label>
                          {others.length === 0 ? (
                            <p className="form-help">This is the only task — it runs first.</p>
                          ) : (
                            <div className="chip-row">
                              {others.map((o) => {
                                const on = t.dependsOn.includes(o.name);
                                return (
                                  <button
                                    type="button"
                                    key={o.uid}
                                    className={`chip toggle ${on ? 'on' : ''}`}
                                    onClick={() => toggleDep(t.uid, o.name)}
                                    aria-pressed={on}
                                  >
                                    {on ? <CheckCircle2 size={11} /> : <Plus size={11} />} {o.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {t.dependsOn.length > 0 && (
                            <p className="form-help">
                              Reads{' '}
                              {t.dependsOn.map((d, i) => (
                                <span key={d}>
                                  {i > 0 && ', '}
                                  <code>${`FLOWFORGE_UPSTREAM_${toEnvName(d)}`}</code>
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="form-label">Timeout (s)</label>
                          <input
                            type="number"
                            min="1"
                            className="form-input"
                            value={t.timeoutSeconds}
                            onChange={(e) => updateTask(t.uid, { timeoutSeconds: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="form-label">Max attempts</label>
                          <input
                            type="number"
                            min="0"
                            className="form-input"
                            value={t.maxRetries}
                            onChange={(e) => updateTask(t.uid, { maxRetries: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button type="button" className="add-task-ghost" onClick={addTask}>
                  <Plus size={16} /> Add task
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="builder-side">
          <section className="card">
            <div className="card-header">
              <div className="card-title">
                <Workflow size={18} /> Preview
              </div>
              <span className="muted small">
                {state.tasks.length} tasks · {validation.levels.length} stages
              </span>
            </div>
            <div className="card-body tight">
              <DagGraph tasks={state.tasks} invalidNames={invalidNames} compact />
            </div>
          </section>

          <section className={`card validation ${validation.valid && !nameError ? 'ok' : 'bad'}`}>
            <div className="card-body">
              {validation.valid && !nameError ? (
                <>
                  <div className="validation-title">
                    <CheckCircle2 size={16} /> Valid DAG
                  </div>
                  <ol className="plan">
                    {validation.levels.map((level, i) => (
                      <li key={i}>
                        <span className="plan-stage">Stage {i + 1}</span>
                        <span className="mono">{level.join(' · ')}</span>
                        {level.length > 1 && <span className="plan-parallel">parallel</span>}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  <div className="validation-title">
                    <AlertTriangle size={16} /> {validation.errors.length + (nameError ? 1 : 0)} problem(s)
                  </div>
                  <ul className="error-list">
                    {nameError && <li>{nameError}</li>}
                    {validation.errors.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </>
              )}
              {serverResult && (
                <div className={`server-check ${serverResult.ok ? 'ok' : 'bad'}`}>
                  {serverResult.ok ? 'Control plane accepted this definition.' : `Control plane rejected it: ${serverResult.message}`}
                </div>
              )}
            </div>
          </section>

          <div className="builder-actions">
            <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => register(true)}>
              <Play size={15} /> Register & run
            </button>
            <button type="button" className="btn btn-secondary" disabled={!canSubmit} onClick={() => register(false)}>
              <Save size={15} /> Register
            </button>
            <button type="button" className="btn btn-ghost" disabled={!validation.valid} onClick={checkOnServer} title="Dry-run validation via POST /api/workflows/validate">
              <ShieldCheck size={15} /> Check on server
            </button>
          </div>

          <section className="card">
            <div className="card-header">
              <div className="card-title">curl</div>
              <CopyButton text={curl} label="Copy" onCopied={() => toast('curl command copied', 'success')} />
            </div>
            <pre className="code-preview small">{curl}</pre>
          </section>
        </aside>
      </div>
    </>
  );
}
