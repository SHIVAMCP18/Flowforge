import { Ban, CheckCircle2, CircleDashed, Clock, Loader2, SkipForward, XCircle } from 'lucide-react';

const ICONS = {
  SUCCEEDED: CheckCircle2,
  FAILED: XCircle,
  RUNNING: Loader2,
  READY: Clock,
  PENDING: CircleDashed,
  SKIPPED: SkipForward,
  CANCELLED: Ban,
};

export function StatusIcon({ status, size = 16, className = '' }) {
  const Icon = ICONS[status] || CircleDashed;
  return <Icon size={size} className={`status-icon status-${status} ${status === 'RUNNING' ? 'spin' : ''} ${className}`} />;
}

export function StatusBadge({ status, large = false }) {
  return (
    <span className={`badge badge-${status} ${large ? 'badge-lg' : ''}`}>
      <span className="badge-dot" />
      {status}
    </span>
  );
}

const SEGMENTS = ['SUCCEEDED', 'RUNNING', 'READY', 'FAILED', 'CANCELLED', 'SKIPPED', 'PENDING'];

/** Stacked bar of task states, e.g. for a run's progress. */
export function TaskProgress({ counts, total, height = 6 }) {
  const sum = total || Object.values(counts || {}).reduce((a, b) => a + b, 0);
  const done = (counts?.SUCCEEDED || 0);
  return (
    <div className="progress" style={{ height }} title={`${done}/${sum} tasks succeeded`}>
      {SEGMENTS.map((s) =>
        counts?.[s] ? (
          <div key={s} className={`progress-seg seg-${s}`} style={{ width: `${(counts[s] / sum) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}
