// Thin client for the control-plane REST API. The base URL comes from (in
// order) the connection panel in the UI, VITE_API_BASE_URL at build time,
// or the same origin (the Vite dev server proxies /api to :8080).

const STORAGE_KEY = 'flowforge.apiBase';

export function getApiBase() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved;
  } catch {
    /* storage unavailable */
  }
  return (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

export function setApiBase(url) {
  try {
    if (url === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''));
  } catch {
    /* storage unavailable */
  }
}

/** The control-plane origin shown in generated curl snippets. */
export function displayBase() {
  return getApiBase() || 'http://localhost:8080';
}

async function request(path, { method = 'GET', body, timeout = 8000 } = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = (data && data.error) || text || `${res.status} ${res.statusText}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createHttpApi() {
  return {
    mode: 'live',
    ping: async () => {
      const data = await request('/api/workflows', { timeout: 2500 });
      if (!Array.isArray(data)) throw new Error('Unexpected response — is this a FlowForge control plane?');
      return true;
    },
    listDefinitions: () => request('/api/workflows'),
    getDefinition: (id) => request(`/api/workflows/${id}`),
    validate: (payload) => request('/api/workflows/validate', { method: 'POST', body: payload }),
    registerDefinition: (payload) => request('/api/workflows', { method: 'POST', body: payload }),
    startRun: (definitionId) => request(`/api/workflows/${definitionId}/runs`, { method: 'POST' }),
    listRuns: ({ status, definitionId, limit = 50 } = {}) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (status) q.set('status', status);
      if (definitionId) q.set('definitionId', definitionId);
      return request(`/api/workflows/runs?${q}`);
    },
    getRun: (id) => request(`/api/workflows/runs/${id}`),
    cancelRun: (id) => request(`/api/workflows/runs/${id}/cancel`, { method: 'POST' }),
    retryRun: (id) => request(`/api/workflows/runs/${id}/retry`, { method: 'POST' }),
  };
}
