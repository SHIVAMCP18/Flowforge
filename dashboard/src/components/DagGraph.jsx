import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Timer } from 'lucide-react';
import { layoutDag, NODE_H, NODE_W } from '../lib/dag';
import { duration } from '../lib/format';
import { StatusIcon } from './Status';
import { usePrefersReducedMotion } from '../lib/hooks';

/**
 * Draws a workflow as a left-to-right layered DAG. Works for both
 * definitions (tasks without status) and runs (tasks with live status):
 * edges animate while data is flowing into a running task, and nodes pulse,
 * pop, or shake as they change state.
 */
export default function DagGraph({ tasks, selected, onSelect, invalidNames = [], compact = false }) {
  const reducedMotion = usePrefersReducedMotion();
  const scrollRef = useRef(null);
  const [scale, setScale] = useState(1);
  const nodes = useMemo(
    () => tasks.map((t) => ({ ...t, name: t.taskName ?? t.name, dependsOn: t.dependsOn || [] })),
    [tasks],
  );
  const layout = useMemo(() => layoutDag(nodes), [nodes]);
  const byName = useMemo(() => new Map(nodes.map((n) => [n.name, n])), [nodes]);
  const invalid = new Set(invalidNames);

  // In compact mode (e.g. the builder preview) shrink the graph to fit its panel instead of scrolling.
  useLayoutEffect(() => {
    if (!compact || !scrollRef.current) return undefined;
    const el = scrollRef.current;
    const fit = () => setScale(Math.max(0.6, Math.min(1, (el.clientWidth - 16) / layout.width)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, layout.width]);
  const s = compact ? scale : 1;

  if (!nodes.length) {
    return <div className="dag-empty">Add a task to see the graph</div>;
  }

  const edgeState = (edge) => {
    const from = byName.get(edge.from)?.status;
    const to = byName.get(edge.to)?.status;
    if (!from) return 'idle';
    if (to === 'FAILED' || to === 'SKIPPED' || to === 'CANCELLED') return from === 'SUCCEEDED' ? 'broken' : 'dim';
    if (from === 'SUCCEEDED' && to === 'RUNNING') return 'flowing';
    if (from === 'SUCCEEDED' && (to === 'SUCCEEDED')) return 'done';
    if (from === 'SUCCEEDED') return 'ready';
    return 'idle';
  };

  return (
    <div ref={scrollRef} className={`dag-scroll ${compact ? 'dag-compact' : ''}`}>
      <div className="dag-fit" style={{ width: layout.width * s, height: layout.height * s }}>
      <div className="dag-canvas" style={{ width: layout.width, height: layout.height, transform: s < 1 ? `scale(${s})` : undefined }}>
        <svg className="dag-edges" width={layout.width} height={layout.height} aria-hidden>
          <defs>
            {['idle', 'ready', 'flowing', 'done', 'broken', 'dim'].map((s) => (
              <marker key={s} id={`arrow-${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={`arrow arrow-${s}`} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((edge) => {
            const state = edgeState(edge);
            return (
              <g key={edge.id} className={`edge edge-${state}`}>
                <path d={edge.path} className="edge-base" markerEnd={`url(#arrow-${state})`} />
                {state === 'flowing' && (
                  <>
                    <path d={edge.path} className="edge-flow" />
                    {!reducedMotion &&
                      [0, 0.6].map((delay) => (
                        <circle key={delay} r="3.5" className="edge-packet">
                          <animateMotion dur="1.2s" begin={`${delay}s`} repeatCount="indefinite" path={edge.path} />
                        </circle>
                      ))}
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {nodes.map((node) => {
          const pos = layout.positions.get(node.name);
          if (!pos) return null;
          const status = node.status;
          const isSelected = selected && selected === node.name;
          return (
            <button
              type="button"
              key={node.name}
              className={[
                'dag-node',
                status ? `node-${status}` : 'node-def',
                isSelected ? 'selected' : '',
                invalid.has(node.name) ? 'node-invalid' : '',
                onSelect ? 'clickable' : '',
              ].join(' ')}
              style={{
                left: pos.x,
                top: pos.y,
                width: NODE_W,
                height: NODE_H,
                animationDelay: `${pos.level * 70}ms`,
              }}
              onClick={() => onSelect?.(node.name)}
              title={node.command}
            >
              <div className="dag-node-header">
                <span className="dag-node-title">{node.name}</span>
                {status ? <StatusIcon status={status} size={15} /> : <span className="dag-node-level">L{pos.level + 1}</span>}
              </div>
              {status ? (
                <div className="dag-node-metrics">
                  <span>
                    <Timer size={11} /> {duration(node.startedAt, node.completedAt)}
                  </span>
                  <span className={node.attempt > 1 ? 'retry-hot' : ''}>
                    <RefreshCw size={11} /> {node.attempt}/{node.maxRetries}
                  </span>
                </div>
              ) : (
                <div className="dag-node-command mono">{node.command || '—'}</div>
              )}
              {status === 'RUNNING' && <div className="node-progress" />}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
