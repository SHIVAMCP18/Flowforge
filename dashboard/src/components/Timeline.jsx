import { computeLevels } from '../lib/dag';
import { durationMs, formatDuration } from '../lib/format';

/**
 * Gantt-style view of a run: one row per task in execution order, bars
 * placed on a shared time axis so parallelism and waiting time are obvious.
 */
export default function Timeline({ run, now, selected, onSelect }) {
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : now;
  const span = Math.max(1000, end - start);

  const order = computeLevels(run.tasks.map((t) => ({ name: t.taskName, dependsOn: t.dependsOn || [] }))).levels.flat();
  const rank = new Map(order.map((n, i) => [n, i]));
  const rows = [...run.tasks].sort((a, b) => (rank.get(a.taskName) ?? 99) - (rank.get(b.taskName) ?? 99));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="timeline">
      <div className="timeline-axis">
        <div className="timeline-label" />
        <div className="timeline-track">
          {ticks.map((t) => (
            <span key={t} className="timeline-tick" style={{ left: `${t * 100}%` }}>
              {formatDuration(span * t)}
            </span>
          ))}
        </div>
      </div>
      {rows.map((task) => {
        const s = task.startedAt ? new Date(task.startedAt).getTime() : null;
        const e = task.completedAt ? new Date(task.completedAt).getTime() : task.status === 'RUNNING' ? now : null;
        const left = s ? ((s - start) / span) * 100 : 0;
        const width = s && e ? Math.max(0.8, ((e - s) / span) * 100) : 0;
        return (
          <button
            type="button"
            key={task.id}
            className={`timeline-row ${selected === task.taskName ? 'selected' : ''}`}
            onClick={() => onSelect?.(task.taskName)}
          >
            <div className="timeline-label mono">{task.taskName}</div>
            <div className="timeline-track">
              {ticks.slice(1, -1).map((t) => (
                <span key={t} className="timeline-grid" style={{ left: `${t * 100}%` }} />
              ))}
              {s ? (
                <div
                  className={`timeline-bar bar-${task.status}`}
                  style={{ left: `${Math.min(99, left)}%`, width: `${Math.min(100 - left, width)}%` }}
                  title={`${task.taskName}: ${formatDuration(durationMs(task.startedAt, task.completedAt))} on ${task.workerId || '—'}`}
                >
                  {width > 12 && <span>{formatDuration(durationMs(task.startedAt, task.completedAt))}</span>}
                </div>
              ) : (
                <span className="timeline-waiting">{task.status.toLowerCase()}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
