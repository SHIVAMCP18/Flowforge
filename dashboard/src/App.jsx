import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Server, 
  Box, 
  ArrowRight,
  Plus,
  Trash2,
  Save,
  Network,
  RefreshCw,
  Code,
  List,
  GitCommit,
  Layers,
  Terminal,
  Settings2
} from 'lucide-react';

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

// Utility to calculate duration
const calculateDuration = (start, end) => {
  if (!start) return '-';
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const diffMs = endTime - startTime;
  
  if (diffMs < 1000) return `${diffMs}ms`;
  return `${(diffMs / 1000).toFixed(2)}s`;
};

export default function App() {
  const [activeView, setActiveView] = useState('dashboard'); // 'dashboard', 'builder', 'run', 'definition'
  const [definitions, setDefinitions] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedDefinition, setSelectedDefinition] = useState(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Builder State
  const [buildName, setBuildName] = useState('data-pipeline');
  const [buildTasks, setBuildTasks] = useState([
    { id: 1, name: 'extract', command: 'echo "Extracting..."', timeoutSeconds: 30, maxRetries: 3, dependsOn: [] }
  ]);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const loadWorkflowRun = async (runId) => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(prev => {
          const exists = prev.find(r => r.id === runId);
          if (exists) {
            return prev.map(r => r.id === runId ? data : r);
          }
          return [data, ...prev];
        });
        
        if (selectedRun && selectedRun.id === runId) {
          setSelectedRun(data);
        }
      }
    } catch (e) {
      console.error('Failed to load run', e);
    }
  };

  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      // Poll runs that are currently active
      const activeRuns = runs.filter(r => r.status === 'RUNNING');
      activeRuns.forEach(run => loadWorkflowRun(run.id));
      
      // Also aggressively poll the selected run if it's running
      if (selectedRun?.status === 'RUNNING') {
        loadWorkflowRun(selectedRun.id);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [runs, selectedRun, autoRefresh]);

  const addTask = () => {
    const newId = buildTasks.length ? Math.max(...buildTasks.map(t => t.id)) + 1 : 1;
    const prevTask = buildTasks.length > 0 ? buildTasks[buildTasks.length - 1].name : '';
    setBuildTasks([
      ...buildTasks, 
      { 
        id: newId, 
        name: `task-${newId}`, 
        command: 'echo "Processing..."', 
        timeoutSeconds: 30, 
        maxRetries: 3, 
        dependsOn: prevTask ? [prevTask] : [] 
      }
    ]);
  };

  const removeTask = (id) => {
    setBuildTasks(buildTasks.filter(t => t.id !== id));
  };

  const updateTask = (id, field, value) => {
    setBuildTasks(buildTasks.map(t => {
      if (t.id === id) {
        if (field === 'dependsOn') {
          return { ...t, dependsOn: value ? value.split(',').map(s => s.trim()).filter(Boolean) : [] };
        }
        return { ...t, [field]: value };
      }
      return t;
    }));
  };

  const deployWorkflow = async () => {
    setIsDeploying(true);
    try {
      const payload = {
        name: buildName,
        tasks: buildTasks.map(({ name, command, timeoutSeconds, maxRetries, dependsOn }) => ({
          name, command, timeoutSeconds: Number(timeoutSeconds), maxRetries: Number(maxRetries), dependsOn
        }))
      };

      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || 'Failed to register workflow');
      }

      const data = await res.json();
      // Store the raw DAG for display purposes later
      data._rawPayload = payload;
      
      setDefinitions([data, ...definitions]);
      addToast(`Workflow '${data.name}' registered (v${data.version})`, 'success');
      setActiveView('dashboard');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  const startRun = async (defId) => {
    try {
      const res = await fetch(`/api/workflows/${defId}/runs`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to start run');
      const data = await res.json();
      setRuns([data, ...runs]);
      setSelectedRun(data);
      setActiveView('run');
      addToast('Workflow execution started', 'info');
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  const viewDefinition = (def) => {
    setSelectedDefinition(def);
    setActiveView('definition');
  };

  // Metrics calculation
  const metrics = useMemo(() => {
    const successful = runs.filter(r => r.status === 'SUCCEEDED');
    
    // Calculate avg run time of successful runs
    let totalDuration = 0;
    successful.forEach(r => {
      if (r.startedAt && r.completedAt) {
        totalDuration += (new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime());
      }
    });
    
    const avgDuration = successful.length > 0 ? (totalDuration / successful.length / 1000).toFixed(2) + 's' : '-';

    return {
      total: runs.length,
      successful: successful.length,
      failed: runs.filter(r => r.status === 'FAILED').length,
      running: runs.filter(r => r.status === 'RUNNING').length,
      avgDuration
    };
  }, [runs]);

  const StatusIcon = ({ status, size = 16 }) => {
    switch (status) {
      case 'SUCCEEDED': return <CheckCircle2 size={size} />;
      case 'FAILED': return <XCircle size={size} />;
      case 'RUNNING': return <Activity size={size} />;
      case 'READY':
      case 'PENDING': return <Clock size={size} />;
      case 'SKIPPED': return <ArrowRight size={size} />;
      default: return <Box size={size} />;
    }
  };

  const renderDashboard = () => (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Operations Center</h1>
          <p className="page-subtitle">Cluster overview and orchestration metrics</p>
        </div>
        <div className="topbar-actions">
           <button 
            className={`btn btn-sm ${autoRefresh ? 'btn-secondary' : 'btn-ghost'}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title="Toggle Auto Refresh"
          >
            <RefreshCw size={14} className={autoRefresh ? 'spin' : ''} style={autoRefresh ? { animation: 'spin 2s linear infinite' } : {}}/>
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button className="btn btn-primary" onClick={() => setActiveView('builder')}>
            <Plus size={16} /> New Workflow
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Total Executions</span>
            <Layers size={18} />
          </div>
          <div className="metric-value">{metrics.total}</div>
        </div>
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Success Rate</span>
            <CheckCircle2 size={18} color="var(--ff-status-succeeded)" />
          </div>
          <div className="metric-value">
            {metrics.total > 0 ? Math.round((metrics.successful / metrics.total) * 100) : 0}%
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Active Runs</span>
            <Activity size={18} color="var(--ff-accent-primary)" />
          </div>
          <div className="metric-value">{metrics.running}</div>
        </div>
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Avg Duration</span>
            <Clock size={18} />
          </div>
          <div className="metric-value">{metrics.avgDuration}</div>
        </div>
      </div>

      <div className="metrics-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Workflows List */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Network size={18} /> Definitions</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {definitions.length === 0 ? (
              <div className="empty-state">
                <Box className="empty-icon" size={32} />
                <div className="empty-title">No workflows defined</div>
                <div style={{ fontSize: '13px' }}>Create a workflow to begin orchestration.</div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Version</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {definitions.map(def => (
                      <tr key={def.id} className="clickable" onClick={() => viewDefinition(def)}>
                        <td style={{ fontWeight: 500 }}>{def.name}</td>
                        <td className="mono">v{def.version}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button 
                            className="btn btn-primary btn-sm" 
                            onClick={(e) => { e.stopPropagation(); startRun(def.id); }}
                          >
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

        {/* Recent Runs List */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><List size={18} /> Recent Executions</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {runs.length === 0 ? (
              <div className="empty-state">
                <Activity className="empty-icon" size={32} />
                <div className="empty-title">No execution history</div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Status</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(run => (
                      <tr key={run.id} className="clickable" onClick={() => { setSelectedRun(run); setActiveView('run'); }}>
                        <td className="mono">{run.id.substring(0, 8)}</td>
                        <td>
                          <span className={`badge badge-${run.status}`}>
                            <span className="badge-dot"></span>
                            {run.status}
                          </span>
                        </td>
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
            <h1 className="page-title mono">{selectedRun.id}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`badge badge-${selectedRun.status}`} style={{ padding: '6px 12px', fontSize: '13px' }}>
              <span className="badge-dot"></span>
              {selectedRun.status}
            </span>
          </div>
        </div>

        {/* DAG View */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <div className="card-title"><GitCommit size={18} /> Execution Graph</div>
            <div className="mono" style={{ color: 'var(--ff-text-muted)', fontSize: '13px' }}>
              Duration: {calculateDuration(selectedRun.startedAt, selectedRun.completedAt)}
            </div>
          </div>
          <div className="dag-container">
            <div className="dag-flow">
              {selectedRun.tasks.map((task, idx) => (
                <React.Fragment key={task.id}>
                  <div className="dag-node-wrapper">
                    <div className="dag-node">
                      <div className="dag-node-header">
                        <span className="dag-node-title">{task.taskName}</span>
                        <StatusIcon status={task.status} size={16} />
                      </div>
                      
                      <div>
                        <span className={`badge badge-${task.status}`}>
                          {task.status}
                        </span>
                      </div>

                      <div className="dag-node-metrics">
                        <div className="dag-node-metric" title="Duration">
                          <Clock size={12} /> {calculateDuration(task.startedAt, task.completedAt)}
                        </div>
                        <div className="dag-node-metric" title="Attempt">
                          <RefreshCw size={12} /> {task.attempt}/{task.maxRetries}
                        </div>
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

        {/* Tasks Table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Terminal size={18} /> Task Execution Log</div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Task Name</th>
                  <th>Status</th>
                  <th>Worker Node</th>
                  <th>Duration</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.tasks.map(task => (
                  <tr key={task.id}>
                    <td style={{ fontWeight: 500 }}>{task.taskName}</td>
                    <td>
                      <span className={`badge badge-${task.status}`}>
                        <span className="badge-dot"></span>
                        {task.status}
                      </span>
                    </td>
                    <td className="mono">{task.workerId || '—'}</td>
                    <td className="mono">{calculateDuration(task.startedAt, task.completedAt)}</td>
                    <td className="mono" style={{ color: 'var(--ff-status-failed)', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {task.errorMessage || '—'}
                    </td>
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
            <ArrowRight size={14} />
            <span className="breadcrumb-current">Workflow Builder</span>
          </div>
          <h1 className="page-title">Define Workflow</h1>
          <p className="page-subtitle">Create a new DAG definition</p>
        </div>
      </div>

      <div className="builder-layout">
        {/* Left Column - Tasks */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Settings2 size={18} /> Configuration</div>
          </div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Workflow Identifier</label>
              <input 
                type="text" 
                className="form-input mono" 
                value={buildName} 
                onChange={e => setBuildName(e.target.value)} 
                placeholder="e.g. etl-pipeline-prod"
              />
            </div>

            <div className="flex items-center justify-between" style={{ marginTop: '32px', marginBottom: '16px' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Task Graph</label>
              <button className="btn btn-secondary btn-sm" onClick={addTask}>
                <Plus size={14} /> Add Task Node
              </button>
            </div>

            <div className="task-list">
              {buildTasks.map((task, idx) => (
                <div key={task.id} className="task-item">
                  <div className="task-item-header">
                    <div className="task-item-title">
                      <Box size={16} color="var(--ff-text-muted)" />
                      Node {idx + 1}
                    </div>
                    <button className="btn btn-ghost btn-icon" onClick={() => removeTask(task.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  
                  <div className="task-item-body">
                    <div>
                      <label className="form-label">Task Name</label>
                      <input type="text" className="form-input mono" value={task.name} onChange={e => updateTask(task.id, 'name', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">Dependencies</label>
                      <input type="text" className="form-input mono" value={task.dependsOn.join(', ')} onChange={e => updateTask(task.id, 'dependsOn', e.target.value)} placeholder="comma separated" />
                    </div>
                    <div className="col-span-2">
                      <label className="form-label">Execution Command (Shell)</label>
                      <input type="text" className="form-input mono" value={task.command} onChange={e => updateTask(task.id, 'command', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">Timeout (sec)</label>
                      <input type="number" className="form-input" value={task.timeoutSeconds} onChange={e => updateTask(task.id, 'timeoutSeconds', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">Max Retries</label>
                      <input type="number" className="form-input" value={task.maxRetries} onChange={e => updateTask(task.id, 'maxRetries', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Preview */}
        <div>
          <div className="card" style={{ position: 'sticky', top: '32px' }}>
            <div className="card-header">
              <div className="card-title"><Code size={18} /> JSON Payload</div>
            </div>
            <div className="card-body">
              <div className="code-preview">
{JSON.stringify({
  name: buildName,
  tasks: buildTasks.map(({ name, command, timeoutSeconds, maxRetries, dependsOn }) => ({
    name, command, timeoutSeconds: Number(timeoutSeconds), maxRetries: Number(maxRetries), dependsOn
  }))
}, null, 2)}
              </div>
              
              <button 
                className="btn btn-primary" 
                style={{ width: '100%', marginTop: '20px' }}
                onClick={deployWorkflow}
                disabled={isDeploying || buildTasks.length === 0 || !buildName}
              >
                {isDeploying ? 'Deploying...' : <><Save size={16} /> Register Workflow</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  const renderDefinition = () => {
    if (!selectedDefinition) return null;
    
    return (
      <>
        <div className="page-header">
          <div>
            <div className="breadcrumb" style={{ marginBottom: '8px' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveView('dashboard')}>Dashboard</span>
              <ArrowRight size={14} />
              <span className="breadcrumb-current">Definition</span>
            </div>
            <h1 className="page-title mono">{selectedDefinition.name}</h1>
            <p className="page-subtitle">Version {selectedDefinition.version}</p>
          </div>
          <div className="topbar-actions">
            <button className="btn btn-primary" onClick={() => startRun(selectedDefinition.id)}>
              <Play size={16} /> Execute Workflow
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><Code size={18} /> Definition Data</div>
          </div>
          <div className="card-body">
             <div className="code-preview" style={{ maxHeight: '600px' }}>
               {selectedDefinition._rawPayload ? JSON.stringify(selectedDefinition._rawPayload, null, 2) : 'No raw payload available in memory. Fetching from backend not fully implemented in UI.'}
             </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <Network className="logo-icon" size={24} />
            FlowForge
          </div>
        </div>
        <nav className="sidebar-nav">
          <div 
            className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} 
            onClick={() => setActiveView('dashboard')}
          >
            <Activity size={18} /> Overview
          </div>
          <div 
            className={`nav-item ${activeView === 'builder' ? 'active' : ''}`} 
            onClick={() => setActiveView('builder')}
          >
            <Plus size={18} /> New Workflow
          </div>
        </nav>
        <div className="sidebar-footer">
          <div className="status-indicator">
            <div className="status-dot"></div>
            Control Plane Connected
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-wrapper">
        <main className="main-content">
          {activeView === 'dashboard' && renderDashboard()}
          {activeView === 'run' && renderRunDetail()}
          {activeView === 'builder' && renderBuilder()}
          {activeView === 'definition' && renderDefinition()}
        </main>
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(toast => (
          <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </div>
  );
}
