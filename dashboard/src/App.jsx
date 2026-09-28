import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, Play, CheckCircle2, XCircle, Clock, Box, ArrowRight,
  Plus, Trash2, Save, Network, RefreshCw, Code, List, GitCommit,
  Terminal, Settings2, Search, X, FileText, LayoutList, Layers, AlertTriangle
} from 'lucide-react';

// ─── Demo data shown when the backend is unreachable ──────────────────────────
const DEMO_DEFINITIONS = [
  { id: 'demo-def-1', name: 'etl-pipeline-prod', version: 1, _rawPayload: { name: 'etl-pipeline-prod', tasks: [{ name: 'extract', command: 'python extract.py --source=s3', timeoutSeconds: 120, maxRetries: 3, dependsOn: [] }, { name: 'transform', command: 'python transform.py', timeoutSeconds: 60, maxRetries: 2, dependsOn: ['extract'] }, { name: 'load', command: 'python load.py --target=warehouse', timeoutSeconds: 60, maxRetries: 2, dependsOn: ['transform'] }] } },
  { id: 'demo-def-2', name: 'nightly-report-generator', version: 2, _rawPayload: { name: 'nightly-report-generator', tasks: [{ name: 'fetch-data', command: 'curl https://api.example.com/data -o data.json', timeoutSeconds: 30, maxRetries: 3, dependsOn: [] }, { name: 'render-pdf', command: 'node render.js', timeoutSeconds: 60, maxRetries: 1, dependsOn: ['fetch-data'] }] } },
];

const now = new Date();
const DEMO_RUNS = [
  { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', status: 'SUCCEEDED', startedAt: new Date(now - 45000).toISOString(), completedAt: new Date(now - 12000).toISOString(), workflowDefinitionId: 'demo-def-1', tasks: [ { id: 't1', taskName: 'extract', status: 'SUCCEEDED', attempt: 1, maxRetries: 3, workerId: 'worker-node-7a2f', startedAt: new Date(now - 45000).toISOString(), completedAt: new Date(now - 34000).toISOString(), checkpointData: 'Extracted 142,381 rows from s3://prod-bucket/events/\nWritten to /tmp/extract_out.parquet', errorMessage: null }, { id: 't2', taskName: 'transform', status: 'SUCCEEDED', attempt: 1, maxRetries: 2, workerId: 'worker-node-3c1e', startedAt: new Date(now - 33000).toISOString(), completedAt: new Date(now - 22000).toISOString(), checkpointData: 'Applied 14 transformation rules.\nNull values filled: 3,201\nOutput: /tmp/transformed.parquet', errorMessage: null }, { id: 't3', taskName: 'load', status: 'SUCCEEDED', attempt: 1, maxRetries: 2, workerId: 'worker-node-7a2f', startedAt: new Date(now - 21000).toISOString(), completedAt: new Date(now - 12000).toISOString(), checkpointData: 'Loading to warehouse...\nRows inserted: 142,381\nRows updated: 0\nDone.', errorMessage: null } ] },
  { id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', status: 'FAILED', startedAt: new Date(now - 120000).toISOString(), completedAt: new Date(now - 90000).toISOString(), workflowDefinitionId: 'demo-def-2', tasks: [ { id: 't4', taskName: 'fetch-data', status: 'SUCCEEDED', attempt: 1, maxRetries: 3, workerId: 'worker-node-9d4b', startedAt: new Date(now - 120000).toISOString(), completedAt: new Date(now - 110000).toISOString(), checkpointData: 'HTTP 200 OK\nContent-Length: 84932 bytes\nWritten to data.json', errorMessage: null }, { id: 't5', taskName: 'render-pdf', status: 'FAILED', attempt: 3, maxRetries: 3, workerId: 'worker-node-2f8c', startedAt: new Date(now - 109000).toISOString(), completedAt: new Date(now - 90000).toISOString(), checkpointData: null, errorMessage: 'Error: Template file not found: templates/report_v2.hbs\n    at FileSystem.readFile (render.js:42)\nExited with code 1' } ] },
  { id: 'c3d4e5f6-a7b8-9012-cdef-123456789012', status: 'RUNNING', startedAt: new Date(now - 15000).toISOString(), completedAt: null, workflowDefinitionId: 'demo-def-1', tasks: [ { id: 't6', taskName: 'extract', status: 'SUCCEEDED', attempt: 1, maxRetries: 3, workerId: 'worker-node-7a2f', startedAt: new Date(now - 15000).toISOString(), completedAt: new Date(now - 5000).toISOString(), checkpointData: 'Extracted 98,241 rows.', errorMessage: null }, { id: 't7', taskName: 'transform', status: 'RUNNING', attempt: 1, maxRetries: 2, workerId: 'worker-node-3c1e', startedAt: new Date(now - 4000).toISOString(), completedAt: null, checkpointData: null, errorMessage: null }, { id: 't8', taskName: 'load', status: 'PENDING', attempt: 0, maxRetries: 2, workerId: null, startedAt: null, completedAt: null, checkpointData: null, errorMessage: null } ] },
];
// ──────────────────────────────────────────────────────────────────────────────

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => onClose(), 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="toast">
      {type === 'success' && <CheckCircle2 className="toast-icon success" size={18} />}
      {type === 'error' && <XCircle className="toast-icon error" size={18} />}
      {type === 'info' && <Activity className="toast-icon info" size={18} />}
      <span>{message}</span>
    </div>
  );
};

const calculateDuration = (start, end) => {
  if (!start) return '-';
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const diffMs = endTime - startTime;
  if (diffMs < 1000) return `${diffMs}ms`;
  return `${(diffMs / 1000).toFixed(2)}s`;
};

export default function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [definitions, setDefinitions] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedDefinition, setSelectedDefinition] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(false);

  const [buildName, setBuildName] = useState('data-pipeline');
  const [buildTasks, setBuildTasks] = useState([
    { id: 1, name: 'extract', command: 'echo "Extracting data..."', timeoutSeconds: 30, maxRetries: 3, dependsOn: [] }
  ]);

  // ── Check backend connectivity on mount ──────────────────────────────────
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch('/api/workflows', { signal: AbortSignal.timeout(2000) });
        if (!res.ok) throw new Error();
      } catch {
        // Backend is unreachable — switch to demo mode
        setIsDemoMode(true);
        setDefinitions(DEMO_DEFINITIONS);
        setRuns(DEMO_RUNS);
        addToast('Backend offline — showing demo data', 'info');
      }
    };
    checkBackend();
  }, []);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
  };
  const removeToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  const loadWorkflowRun = async (runId) => {
    if (isDemoMode) return;
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(prev => {
          const exists = prev.find(r => r.id === runId);
          if (exists) return prev.map(r => r.id === runId ? data : r);
          return [data, ...prev];
        });
        if (selectedRun?.id === runId) {
          setSelectedRun(data);
          if (selectedTask) {
            const updatedTask = data.tasks.find(t => t.id === selectedTask.id);
            if (updatedTask) setSelectedTask(updatedTask);
          }
        }
      }
    } catch (e) { console.error('Failed to load run', e); }
  };

  useEffect(() => {
    if (!autoRefresh || isDemoMode) return;
    const interval = setInterval(() => {
      runs.filter(r => r.status === 'RUNNING').forEach(run => loadWorkflowRun(run.id));
      if (selectedRun?.status === 'RUNNING') loadWorkflowRun(selectedRun.id);
    }, 1000);
    return () => clearInterval(interval);
  }, [runs, selectedRun, autoRefresh, selectedTask, isDemoMode]);

  const addTask = () => {
    const newId = buildTasks.length ? Math.max(...buildTasks.map(t => t.id)) + 1 : 1;
    const prevTask = buildTasks.length > 0 ? buildTasks[buildTasks.length - 1].name : '';
    setBuildTasks([...buildTasks, { id: newId, name: `task-${newId}`, command: 'echo "Processing..."', timeoutSeconds: 30, maxRetries: 3, dependsOn: prevTask ? [prevTask] : [] }]);
  };
  const removeTask = (id) => setBuildTasks(buildTasks.filter(t => t.id !== id));
  const updateTask = (id, field, value) => setBuildTasks(buildTasks.map(t => {
    if (t.id !== id) return t;
    if (field === 'dependsOn') return { ...t, dependsOn: value ? value.split(',').map(s => s.trim()).filter(Boolean) : [] };
    return { ...t, [field]: value };
  }));

  const deployWorkflow = async () => {
    if (isDemoMode) { addToast('Connect a live backend to register workflows', 'error'); return; }
    setIsDeploying(true);
    try {
      const payload = { name: buildName, tasks: buildTasks.map(({ name, command, timeoutSeconds, maxRetries, dependsOn }) => ({ name, command, timeoutSeconds: Number(timeoutSeconds), maxRetries: Number(maxRetries), dependsOn })) };
      const res = await fetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text() || 'Failed to register workflow');
      const data = await res.json();
      data._rawPayload = payload;
      setDefinitions([data, ...definitions]);
      addToast(`Workflow '${data.name}' registered (v${data.version})`, 'success');
      setActiveView('dashboard');
    } catch (e) { addToast(e.message, 'error'); } finally { setIsDeploying(false); }
  };

  const startRun = async (defId) => {
    if (isDemoMode) { addToast('Connect a live backend to execute workflows', 'error'); return; }
    try {
      const res = await fetch(`/api/workflows/${defId}/runs`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start run');
      const data = await res.json();
      setRuns([data, ...runs]);
      setSelectedRun(data);
      setActiveView('run');
      addToast('Workflow execution started', 'info');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const metrics = useMemo(() => {
    const successful = runs.filter(r => r.status === 'SUCCEEDED');
    let totalDuration = 0;
    successful.forEach(r => { if (r.startedAt && r.completedAt) totalDuration += (new Date(r.completedAt) - new Date(r.startedAt)); });
    return {
      total: runs.length,
      successful: successful.length,
      failed: runs.filter(r => r.status === 'FAILED').length,
      running: runs.filter(r => r.status === 'RUNNING').length,
      avgDuration: successful.length > 0 ? (totalDuration / successful.length / 1000).toFixed(2) + 's' : '-'
    };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    if (!searchQuery) return runs;
    const q = searchQuery.toLowerCase();
    return runs.filter(r => r.id.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
  }, [runs, searchQuery]);

  const StatusIcon = ({ status, size = 16 }) => {
    switch (status) {
      case 'SUCCEEDED': return <CheckCircle2 size={size} />;
      case 'FAILED': return <XCircle size={size} />;
      case 'RUNNING': return <Activity size={size} />;
      case 'READY': case 'PENDING': return <Clock size={size} />;
      case 'SKIPPED': return <ArrowRight size={size} />;
      default: return <Box size={size} />;
    }
  };

  const DemoBanner = () => isDemoMode ? (
    <div style={{ background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.25)', borderRadius: '6px', padding: '10px 16px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#fde047' }}>
      <AlertTriangle size={16} />
      <span><strong>Demo Mode</strong> — Backend not reachable. Showing sample data to illustrate the dashboard. Run the stack locally to interact with a live cluster.</span>
    </div>
  ) : null;

  const renderDashboard = () => (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Operations Center</h1>
          <p className="page-subtitle">Cluster overview and orchestration metrics</p>
        </div>
        <div className="topbar-actions">
          <button className={`btn btn-sm ${autoRefresh ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setAutoRefresh(!autoRefresh)}>
            <RefreshCw size={14} style={autoRefresh ? { animation: 'spin 2s linear infinite' } : {}} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button className="btn btn-primary" onClick={() => setActiveView('builder')}>
            <Plus size={16} /> New Workflow
          </button>
        </div>
      </div>
      <DemoBanner />

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">Total Executions</span><Layers size={18} /></div>
          <div className="metric-value">{metrics.total}</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">Success Rate</span><CheckCircle2 size={18} color="var(--ff-status-succeeded)" /></div>
          <div className="metric-value">{metrics.total > 0 ? Math.round((metrics.successful / metrics.total) * 100) : 0}%</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">Active Runs</span><Activity size={18} color="var(--ff-accent-primary)" /></div>
          <div className="metric-value">{metrics.running}</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">Avg Duration</span><Clock size={18} /></div>
          <div className="metric-value">{metrics.avgDuration}</div>
        </div>
      </div>

      <div className="metrics-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="card-header"><div className="card-title"><Network size={18} /> Definitions</div></div>
          <div className="card-body" style={{ padding: 0 }}>
            {definitions.length === 0 ? (
              <div className="empty-state"><Box className="empty-icon" size={32} /><div className="empty-title">No workflows defined</div></div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Name</th><th>Version</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                  <tbody>
                    {definitions.map(def => (
                      <tr key={def.id} className="clickable" onClick={() => { setSelectedDefinition(def); setActiveView('definition'); }}>
                        <td style={{ fontWeight: 500 }}>{def.name}</td>
                        <td className="mono">v{def.version}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); startRun(def.id); }}>
                            <Play size={14} /> Execute
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header" style={{ paddingBottom: '16px' }}>
            <div className="card-title"><List size={18} /> Recent Executions</div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ff-text-muted)' }} />
              <input type="text" placeholder="Search..." className="form-input" style={{ paddingLeft: '32px', padding: '6px 12px 6px 32px', fontSize: '12px', width: '180px' }} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {filteredRuns.length === 0 ? (
              <div className="empty-state"><Activity className="empty-icon" size={32} /><div className="empty-title">{runs.length === 0 ? 'No execution history' : 'No matching runs'}</div></div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>ID</th><th>Status</th><th>Duration</th></tr></thead>
                  <tbody>
                    {filteredRuns.map(run => (
                      <tr key={run.id} className="clickable" onClick={() => { setSelectedRun(run); setActiveView('run'); }}>
                        <td className="mono" style={{ fontSize: '12px' }}>{run.id.substring(0, 16)}...</td>
                        <td><span className={`badge badge-${run.status}`}><span className="badge-dot"></span>{run.status}</span></td>
                        <td className="mono">{calculateDuration(run.startedAt, run.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const renderRunDetail = () => {
    if (!selectedRun) return null;
    return (
      <>
        <div className="page-header">
          <div>
            <div className="breadcrumb" style={{ marginBottom: '8px' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveView('dashboard')}>Dashboard</span>
              <ArrowRight size={14} />
              <span className="breadcrumb-current">Run Details</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h1 className="page-title mono" style={{ fontSize: '18px' }}>{selectedRun.id}</h1>
              <button className="btn btn-ghost btn-icon" title="Copy ID" onClick={() => { navigator.clipboard.writeText(selectedRun.id); addToast('Run ID copied', 'success'); }}>
                <FileText size={14} />
              </button>
            </div>
          </div>
          <span className={`badge badge-${selectedRun.status}`} style={{ padding: '6px 12px', fontSize: '13px' }}>
            <span className="badge-dot"></span>{selectedRun.status}
          </span>
        </div>

        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <div className="card-title"><GitCommit size={18} /> Execution Graph</div>
            <div className="mono" style={{ color: 'var(--ff-text-muted)', fontSize: '13px' }}>Duration: {calculateDuration(selectedRun.startedAt, selectedRun.completedAt)}</div>
          </div>
          <div className="dag-container">
            <div className="dag-flow">
              {selectedRun.tasks.map((task, idx) => (
                <React.Fragment key={task.id}>
                  <div className="dag-node-wrapper">
                    <div className="dag-node clickable" style={{ cursor: 'pointer', borderColor: selectedTask?.id === task.id ? 'var(--ff-accent-primary)' : '' }} onClick={() => setSelectedTask(task)}>
                      <div className="dag-node-header">
                        <span className="dag-node-title">{task.taskName}</span>
                        <StatusIcon status={task.status} size={16} />
                      </div>
                      <div><span className={`badge badge-${task.status}`}>{task.status}</span></div>
                      <div className="dag-node-metrics">
                        <div className="dag-node-metric"><Clock size={12} /> {calculateDuration(task.startedAt, task.completedAt)}</div>
                        <div className="dag-node-metric"><RefreshCw size={12} /> {task.attempt}/{task.maxRetries}</div>
                      </div>
                    </div>
                  </div>
                  {idx < selectedRun.tasks.length - 1 && (
                    <div className={`dag-edge ${task.status === 'SUCCEEDED' ? 'active' : ''}`}></div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title"><LayoutList size={18} /> Task List (click for output)</div></div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Task Name</th><th>Status</th><th>Worker Node</th><th>Duration</th></tr></thead>
              <tbody>
                {selectedRun.tasks.map(task => (
                  <tr key={task.id} className="clickable" onClick={() => setSelectedTask(task)}>
                    <td style={{ fontWeight: 500 }}>{task.taskName}</td>
                    <td><span className={`badge badge-${task.status}`}><span className="badge-dot"></span>{task.status}</span></td>
                    <td className="mono">{task.workerId || '—'}</td>
                    <td className="mono">{calculateDuration(task.startedAt, task.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  const renderBuilder = () => (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb" style={{ marginBottom: '8px' }}>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveView('dashboard')}>Dashboard</span>
            <ArrowRight size={14} /><span className="breadcrumb-current">Workflow Builder</span>
          </div>
          <h1 className="page-title">Define Workflow</h1>
        </div>
      </div>
      <DemoBanner />
      <div className="builder-layout">
        <div className="card">
          <div className="card-header"><div className="card-title"><Settings2 size={18} /> Configuration</div></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Workflow Identifier</label>
              <input type="text" className="form-input mono" value={buildName} onChange={e => setBuildName(e.target.value)} />
            </div>
            <div className="flex items-center justify-between" style={{ marginTop: '32px', marginBottom: '16px' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Task Graph</label>
              <button className="btn btn-secondary btn-sm" onClick={addTask}><Plus size={14} /> Add Task</button>
            </div>
            <div className="task-list">
              {buildTasks.map((task, idx) => (
                <div key={task.id} className="task-item">
                  <div className="task-item-header">
                    <div className="task-item-title"><Box size={16} color="var(--ff-text-muted)" /> Node {idx + 1}</div>
                    <button className="btn btn-ghost btn-icon" onClick={() => removeTask(task.id)}><Trash2 size={16} /></button>
                  </div>
                  <div className="task-item-body">
                    <div><label className="form-label">Task Name</label><input type="text" className="form-input mono" value={task.name} onChange={e => updateTask(task.id, 'name', e.target.value)} /></div>
                    <div><label className="form-label">Dependencies</label><input type="text" className="form-input mono" value={task.dependsOn.join(', ')} onChange={e => updateTask(task.id, 'dependsOn', e.target.value)} placeholder="comma separated" /></div>
                    <div className="col-span-2"><label className="form-label">Command (Shell)</label><input type="text" className="form-input mono" value={task.command} onChange={e => updateTask(task.id, 'command', e.target.value)} /></div>
                    <div><label className="form-label">Timeout (sec)</label><input type="number" className="form-input" value={task.timeoutSeconds} onChange={e => updateTask(task.id, 'timeoutSeconds', e.target.value)} /></div>
                    <div><label className="form-label">Max Retries</label><input type="number" className="form-input" value={task.maxRetries} onChange={e => updateTask(task.id, 'maxRetries', e.target.value)} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="card" style={{ position: 'sticky', top: '32px' }}>
            <div className="card-header"><div className="card-title"><Code size={18} /> JSON Payload</div></div>
            <div className="card-body">
              <div className="code-preview">{JSON.stringify({ name: buildName, tasks: buildTasks.map(t => ({ name: t.name, command: t.command, timeoutSeconds: Number(t.timeoutSeconds), maxRetries: Number(t.maxRetries), dependsOn: t.dependsOn })) }, null, 2)}</div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: '20px' }} onClick={deployWorkflow} disabled={isDeploying || buildTasks.length === 0 || !buildName}>
                {isDeploying ? 'Deploying...' : <><Save size={16} /> Register Workflow</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo"><Network className="logo-icon" size={24} /> FlowForge</div>
        </div>
        <nav className="sidebar-nav">
          <div className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveView('dashboard')}>
            <Activity size={18} /> Overview
          </div>
          <div className={`nav-item ${activeView === 'builder' ? 'active' : ''}`} onClick={() => setActiveView('builder')}>
            <Plus size={18} /> New Workflow
          </div>
        </nav>
        <div className="sidebar-footer">
          <div className="status-indicator">
            <div className={`status-dot`} style={{ background: isDemoMode ? 'var(--ff-status-running)' : 'var(--ff-status-succeeded)', boxShadow: isDemoMode ? '0 0 0 2px rgba(234,179,8,0.2)' : '0 0 0 2px rgba(34,197,94,0.2)' }}></div>
            {isDemoMode ? 'Demo Mode' : 'Live'}
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        <main className="main-content" style={{ flex: 1 }}>
          {activeView === 'dashboard' && renderDashboard()}
          {activeView === 'run' && renderRunDetail()}
          {activeView === 'builder' && renderBuilder()}
          {activeView === 'definition' && selectedDefinition && (
            <>
              <div className="page-header">
                <div>
                  <div className="breadcrumb" style={{ marginBottom: '8px' }}>
                    <span style={{ cursor: 'pointer' }} onClick={() => setActiveView('dashboard')}>Dashboard</span>
                    <ArrowRight size={14} /><span className="breadcrumb-current">Definition</span>
                  </div>
                  <h1 className="page-title mono">{selectedDefinition.name}</h1>
                  <p className="page-subtitle">Version {selectedDefinition.version}</p>
                </div>
                <button className="btn btn-primary" onClick={() => startRun(selectedDefinition.id)}><Play size={16} /> Execute Workflow</button>
              </div>
              <div className="card">
                <div className="card-header"><div className="card-title"><Code size={18} /> Definition Data</div></div>
                <div className="card-body">
                  <div className="code-preview" style={{ maxHeight: '600px' }}>
                    {selectedDefinition._rawPayload ? JSON.stringify(selectedDefinition._rawPayload, null, 2) : 'No raw payload cached.'}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        {/* Slide-out task log panel */}
        {selectedTask && (
          <div style={{ width: '380px', borderLeft: '1px solid var(--ff-border-light)', background: 'var(--ff-bg-panel)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
            <div style={{ padding: '20px', borderBottom: '1px solid var(--ff-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                <Terminal size={16} /> {selectedTask.taskName}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setSelectedTask(null)}><X size={18} /></button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--ff-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</div>
                <span className={`badge badge-${selectedTask.status}`}><span className="badge-dot"></span>{selectedTask.status}</span>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--ff-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Worker ID</div>
                <div className="mono" style={{ fontSize: '13px' }}>{selectedTask.workerId || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--ff-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duration</div>
                <div className="mono" style={{ fontSize: '13px' }}>{calculateDuration(selectedTask.startedAt, selectedTask.completedAt)}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: 'var(--ff-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Standard Output</div>
                <div className="code-preview" style={{ background: '#000', color: '#a1a1aa', minHeight: '200px' }}>
                  {selectedTask.status === 'FAILED'
                    ? <span style={{ color: '#ef4444' }}>{selectedTask.errorMessage || 'Execution failed.'}</span>
                    : selectedTask.checkpointData
                      ? <span style={{ color: '#22c55e' }}>{selectedTask.checkpointData}</span>
                      : <span style={{ color: '#52525b' }}>No output recorded yet.</span>
                  }
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="toast-container">
        {toasts.map(toast => (
          <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </div>
  );
}
