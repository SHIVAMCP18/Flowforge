export function durationMs(start, end) {
  if (!start) return null;
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, e - s);
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function duration(start, end) {
  return formatDuration(durationMs(start, end));
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const shortId = (id) => (id ? id.slice(0, 8) : '');

export function countStatuses(tasks) {
  const counts = {};
  for (const t of tasks || []) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

export const TERMINAL_RUN = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export const STATUS_ORDER = ['SUCCEEDED', 'RUNNING', 'READY', 'PENDING', 'FAILED', 'SKIPPED', 'CANCELLED'];

/** Shell-safe single-quoting for generated curl commands. */
export const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function toEnvName(taskName) {
  return taskName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
