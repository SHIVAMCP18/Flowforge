import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BookOpen, Keyboard, Menu, Network, Plug, Plus, X } from 'lucide-react';
import Dashboard from './views/Dashboard';
import RunDetail from './views/RunDetail';
import Builder from './views/Builder';
import DefinitionDetail from './views/DefinitionDetail';
import Docs from './views/Docs';
import Toasts from './components/Toasts';
import Modal from './components/Modal';
import { createHttpApi, getApiBase, setApiBase } from './lib/api';
import { createDemoApi } from './lib/demo';

function parseRoute(hash) {
  const path = hash.replace(/^#/, '') || '/';
  let m;
  if ((m = path.match(/^\/runs\/([^/]+)$/))) return { name: 'run', id: m[1] };
  if ((m = path.match(/^\/definitions\/([^/]+)$/))) return { name: 'definition', id: m[1] };
  if (path === '/builder') return { name: 'builder' };
  if (path === '/docs') return { name: 'docs' };
  return { name: 'dashboard' };
}

const SHORTCUTS = [
  ['N', 'New workflow'],
  ['D', 'Dashboard'],
  ['/', 'Search runs'],
  ['?', 'Show shortcuts'],
  ['Esc', 'Close panels & dialogs'],
];

let toastSeq = 0;

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [api, setApi] = useState(null);
  const [connecting, setConnecting] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [builderSeed, setBuilderSeed] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

  const toast = useCallback((message, type = 'info') => {
    setToasts((prev) => [...prev.slice(-3), { id: ++toastSeq, message, type }]);
  }, []);
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const navigate = useCallback((path) => {
    window.location.hash = path;
    setNavOpen(false);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const connect = useCallback(
    async ({ quiet = false } = {}) => {
      const live = createHttpApi();
      try {
        await live.ping();
        setApi(live);
        if (!quiet) toast(`Connected to control plane ${getApiBase() || '(same origin)'}`, 'success');
        return true;
      } catch {
        setApi((prev) => (prev?.mode === 'demo' ? prev : createDemoApi()));
        if (!quiet) toast('No control plane reachable — running the in-browser demo cluster', 'info');
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    connect({ quiet: true }).then((ok) => {
      if (!ok) toast('Demo mode: a simulated cluster is running in your browser', 'info');
    });
  }, [connect, toast]);

  const startRun = useCallback(
    async (definitionId) => {
      try {
        const run = await api.startRun(definitionId);
        toast('Run started', 'success');
        navigate(`/runs/${run.id}`);
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    [api, navigate, toast],
  );

  const editDefinition = useCallback(
    (payload) => {
      setBuilderSeed({ payload, key: Date.now() });
      navigate('/builder');
    },
    [navigate],
  );

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        setBuilderSeed(null);
        navigate('/builder');
      } else if (e.key === 'd' || e.key === 'D') navigate('/');
      else if (e.key === '?') setModal('shortcuts');
      else if (e.key === '/') {
        const el = document.getElementById('run-search');
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const nav = useMemo(
    () => [
      { label: 'Overview', icon: Activity, path: '/', active: route.name === 'dashboard' || route.name === 'run' || route.name === 'definition' },
      { label: 'New workflow', icon: Plus, path: '/builder', active: route.name === 'builder' },
      { label: 'Developer guide', icon: BookOpen, path: '/docs', active: route.name === 'docs' },
    ],
    [route.name],
  );

  const isDemo = api?.mode === 'demo';

  return (
    <div className="app-layout">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <button type="button" className="logo" onClick={() => navigate('/')}>
            <span className="logo-mark">
              <Network size={18} />
            </span>
            FlowForge
          </button>
          <button type="button" className="btn btn-ghost btn-icon mobile-only" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {nav.map(({ label, icon: Icon, path, active }) => (
            <button
              type="button"
              key={path}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => {
                if (path === '/builder') setBuilderSeed(null);
                navigate(path);
              }}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="connection" onClick={() => setModal('connection')}>
            <span className={`status-dot ${connecting ? 'connecting' : isDemo ? 'demo' : 'live'}`} />
            <span className="connection-text">
              <strong>{connecting ? 'Connecting…' : isDemo ? 'Demo cluster' : 'Live cluster'}</strong>
              <small>{isDemo ? 'Simulated in browser' : getApiBase() || 'same origin'}</small>
            </span>
            <Plug size={14} />
          </button>
          <button type="button" className="nav-item subtle" onClick={() => setModal('shortcuts')}>
            <Keyboard size={16} /> Shortcuts <kbd>?</kbd>
          </button>
        </div>
      </aside>
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} />}

      <div className="main-column">
        <header className="mobile-topbar">
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <span className="logo small">
            <Network size={16} /> FlowForge
          </span>
          <span className={`status-dot ${isDemo ? 'demo' : 'live'}`} />
        </header>

        {isDemo && (
          <div className="demo-banner">
            <span>
              <strong>Demo mode</strong> — a simulated scheduler and worker pool are running in your browser. Everything is
              interactive; nothing leaves this tab.
            </span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModal('connection')}>
              <Plug size={13} /> Connect a control plane
            </button>
          </div>
        )}

        <main className="main-content" key={`${route.name}-${route.id || ''}`}>
          {!api ? (
            <div className="boot">
              <span className="boot-spinner" />
              Connecting to control plane…
            </div>
          ) : route.name === 'run' ? (
            <RunDetail api={api} runId={route.id} navigate={navigate} toast={toast} />
          ) : route.name === 'definition' ? (
            <DefinitionDetail api={api} definitionId={route.id} navigate={navigate} toast={toast} onStartRun={startRun} onEdit={editDefinition} />
          ) : route.name === 'builder' ? (
            <Builder
              key={builderSeed?.key || 'draft'}
              api={api}
              navigate={navigate}
              toast={toast}
              initial={builderSeed?.payload}
              onStartRun={startRun}
            />
          ) : route.name === 'docs' ? (
            <Docs toast={toast} />
          ) : (
            <Dashboard api={api} navigate={navigate} toast={toast} onStartRun={startRun} />
          )}
        </main>
      </div>

      {modal === 'shortcuts' && (
        <Modal title="Keyboard shortcuts" onClose={() => setModal(null)} width={420}>
          <table className="kv-table">
            <tbody>
              {SHORTCUTS.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {modal === 'connection' && (
        <ConnectionDialog
          onClose={() => setModal(null)}
          onConnect={async (url) => {
            setApiBase(url);
            setConnecting(true);
            const ok = await connect();
            if (ok) setModal(null);
            return ok;
          }}
          onDemo={() => {
            setApi(createDemoApi());
            setModal(null);
            toast('Switched to the demo cluster', 'info');
          }}
        />
      )}

      <Toasts toasts={toasts} onClose={dismissToast} />
    </div>
  );
}

function ConnectionDialog({ onClose, onConnect, onDemo }) {
  const [url, setUrl] = useState(getApiBase() || 'http://localhost:8080');
  const [state, setState] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setState('testing');
    const ok = await onConnect(url.trim());
    setState(ok ? null : 'failed');
  };

  return (
    <Modal title="Connect to a control plane" onClose={onClose}>
      <form onSubmit={submit} className="connection-form">
        <label className="form-label" htmlFor="api-url">Control plane URL</label>
        <input id="api-url" className="form-input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8080" />
        <p className="form-help">
          Leave empty to use this page&apos;s origin (the Vite dev server proxies <code>/api</code> to :8080). Cross-origin URLs
          need <code>CORS_ALLOWED_ORIGINS</code> on the control plane.
        </p>
        {state === 'failed' && <p className="form-error">Could not reach a FlowForge control plane at that address.</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onDemo}>
            Use demo cluster
          </button>
          <button type="submit" className="btn btn-primary" disabled={state === 'testing'}>
            <Plug size={14} /> {state === 'testing' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
