// Client-side mirror of the control plane's DagValidator, plus a layered
// layout for drawing the graph. Keeping the rules identical means the
// builder can flag problems as you type instead of on submit.

export function validateDag(tasks) {
  const errors = [];
  const names = new Map();

  if (!tasks.length) errors.push({ task: null, message: 'A workflow needs at least one task' });

  tasks.forEach((t, i) => {
    const name = (t.name || '').trim();
    if (!name) errors.push({ task: i, message: `Task #${i + 1} needs a name` });
    else if (names.has(name)) errors.push({ task: i, message: `Duplicate task name "${name}"` });
    else names.set(name, i);
    if (!(t.command || '').trim()) errors.push({ task: i, message: `"${name || `#${i + 1}`}" needs a command` });
    if (t.timeoutSeconds !== '' && t.timeoutSeconds != null && Number(t.timeoutSeconds) <= 0)
      errors.push({ task: i, message: `"${name}" timeout must be positive` });
    if (t.maxRetries !== '' && t.maxRetries != null && Number(t.maxRetries) < 0)
      errors.push({ task: i, message: `"${name}" retries cannot be negative` });
  });

  tasks.forEach((t, i) => {
    for (const dep of t.dependsOn || []) {
      if (dep === t.name) errors.push({ task: i, message: `"${t.name}" cannot depend on itself` });
      else if (!names.has(dep)) errors.push({ task: i, message: `"${t.name}" depends on unknown task "${dep}"` });
    }
  });

  const { levels, cyclic } = computeLevels(tasks);
  if (cyclic.length) errors.push({ task: null, message: `Dependency cycle between: ${cyclic.join(', ')}` });

  return { valid: errors.length === 0, errors, levels: levels.filter((l) => l.length), cyclic };
}

/**
 * Kahn's algorithm, level by level. Tasks in the same level can run in
 * parallel. Tasks stuck in a cycle are returned separately so the layout can
 * still draw them (in a final column) instead of looping forever.
 */
export function computeLevels(tasks) {
  const byName = new Map(tasks.filter((t) => t.name).map((t) => [t.name, t]));
  const indegree = new Map();
  const dependents = new Map();
  for (const t of byName.values()) {
    const deps = [...new Set(t.dependsOn || [])].filter((d) => byName.has(d) && d !== t.name);
    indegree.set(t.name, deps.length);
    for (const d of deps) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(t.name);
    }
  }

  const levels = [];
  let current = [...indegree].filter(([, deg]) => deg === 0).map(([n]) => n);
  const placed = new Set();
  while (current.length) {
    levels.push(current);
    current.forEach((n) => placed.add(n));
    const next = [];
    for (const n of current) {
      for (const down of dependents.get(n) || []) {
        indegree.set(down, indegree.get(down) - 1);
        if (indegree.get(down) === 0) next.push(down);
      }
    }
    current = next;
  }
  const cyclic = [...byName.keys()].filter((n) => !placed.has(n));
  return { levels, cyclic };
}

export const NODE_W = 184;
export const NODE_H = 76;
const COL_GAP = 84;
const ROW_GAP = 26;
const PAD = 24;

/** Positions every task on a left-to-right layered grid and returns edges between them. */
export function layoutDag(tasks) {
  const { levels, cyclic } = computeLevels(tasks);
  const columns = levels.map((l) => [...l]);
  if (cyclic.length) columns.push(cyclic);

  const deps = new Map(tasks.map((t) => [t.name, (t.dependsOn || []).filter(Boolean)]));
  const rowOf = new Map();

  // Order each column by the average row of its parents to reduce edge crossings.
  columns.forEach((col, ci) => {
    if (ci > 0) {
      const score = (n) => {
        const parents = (deps.get(n) || []).filter((p) => rowOf.has(p));
        return parents.length ? parents.reduce((s, p) => s + rowOf.get(p), 0) / parents.length : Infinity;
      };
      col.sort((a, b) => score(a) - score(b));
    }
    col.forEach((n, ri) => rowOf.set(n, ri));
  });

  const tallest = Math.max(1, ...columns.map((c) => c.length));
  const height = tallest * NODE_H + (tallest - 1) * ROW_GAP + PAD * 2;
  const width = Math.max(1, columns.length) * NODE_W + Math.max(0, columns.length - 1) * COL_GAP + PAD * 2;

  const positions = new Map();
  columns.forEach((col, ci) => {
    const colHeight = col.length * NODE_H + (col.length - 1) * ROW_GAP;
    const top = (height - colHeight) / 2;
    col.forEach((n, ri) => {
      positions.set(n, { x: PAD + ci * (NODE_W + COL_GAP), y: top + ri * (NODE_H + ROW_GAP), level: ci });
    });
  });

  const edges = [];
  for (const t of tasks) {
    const to = positions.get(t.name);
    if (!to) continue;
    for (const d of new Set(t.dependsOn || [])) {
      const from = positions.get(d);
      if (!from || d === t.name) continue;
      const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
      const x2 = to.x, y2 = to.y + NODE_H / 2;
      const backwards = x2 <= x1;
      const dx = backwards ? 60 : Math.max(40, (x2 - x1) / 2);
      edges.push({
        id: `${d}->${t.name}`,
        from: d,
        to: t.name,
        path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      });
    }
  }

  return { positions, edges, width, height };
}
