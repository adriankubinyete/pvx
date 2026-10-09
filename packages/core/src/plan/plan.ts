import type { EvalResult } from "./evaluate.ts";

export interface PlanStep {
  cmd: string;
  for: string[];
  implicit: boolean;
  reason?: string;
  optIn?: boolean;
}
export interface Plan {
  steps: PlanStep[];
  manual: EvalResult[];
}

export function buildPlan(results: EvalResult[]): Plan {
  const byId = new Map(results.map((r, i) => [r.id, { r, i }]));
  const nodes = new Map<string, PlanStep & { idx: number }>();
  const manual: EvalResult[] = [];
  const stepOf = new Map<string, string>(); // capability id -> cmd

  const add = (r: EvalResult, idx: number, implicit: boolean, reason?: string) => {
    const cmd = r.fix!;
    stepOf.set(r.id, cmd);
    const n = nodes.get(cmd);
    if (n) {
      if (!n.for.includes(r.id)) n.for.push(r.id);
      n.idx = Math.min(n.idx, idx);
      n.optIn ||= r.optIn;
      return;
    }
    nodes.set(cmd, { cmd, for: [r.id], implicit, reason, idx, ...(r.optIn ? { optIn: true } : {}) });
  };

  results.forEach((r, i) => {
    if (r.level === "ok") return;
    if (r.fix) add(r, i, false);
    else manual.push(r);
  });

  // edges: from -> to means "from runs before to"
  const edges = new Map<string, Set<string>>();
  const edge = (from: string, to: string) => {
    if (from !== to) (edges.get(from) ?? edges.set(from, new Set()).get(from)!).add(to);
  };

  // affects: implicit steps first (they add nodes), then edges.
  const affectors = new Map<string, string[]>();
  for (const r of results) {
    if (r.level === "ok" || !r.fix) continue;
    for (const t of r.affects ?? []) affectors.set(t, [...(affectors.get(t) ?? []), r.id]);
  }
  for (const [t, by] of affectors) {
    const target = byId.get(t);
    if (!target || !target.r.fix) continue;
    if (!stepOf.has(t)) add(target.r, target.i, true, `afetado por ${by.join(", ")}`);
    for (const a of by) edge(stepOf.get(a)!, stepOf.get(t)!);
  }

  for (const r of results) {
    const cmd = stepOf.get(r.id);
    if (!cmd || r.level === "ok") continue;
    for (const n of r.needs ?? []) if (stepOf.has(n)) edge(stepOf.get(n)!, cmd);
  }

  // Kahn, always picking the lowest profile index among the ready ones.
  const indeg = new Map([...nodes.keys()].map((k) => [k, 0]));
  for (const tos of edges.values()) for (const t of tos) indeg.set(t, indeg.get(t)! + 1);
  const steps: PlanStep[] = [];
  const left = new Set(nodes.keys());
  while (left.size) {
    const ready = [...left].filter((k) => indeg.get(k) === 0).sort((a, b) => nodes.get(a)!.idx - nodes.get(b)!.idx);
    const next = ready[0];
    if (next === undefined) throw new Error(`ciclo em needs/affects: ${findCycle(left, edges).join(" -> ")}`);
    left.delete(next);
    for (const t of edges.get(next) ?? []) indeg.set(t, indeg.get(t)! - 1);
    const { idx: _idx, ...step } = nodes.get(next)!;
    steps.push(step);
  }
  return { steps, manual };
}

/** DFS inside the unresolved set; every node there has a predecessor in it, so a cycle exists. */
function findCycle(left: Set<string>, edges: Map<string, Set<string>>): string[] {
  const path: string[] = [];
  const visit = (k: string): string[] | null => {
    const at = path.indexOf(k);
    if (at >= 0) return [...path.slice(at), k];
    path.push(k);
    for (const t of edges.get(k) ?? []) if (left.has(t)) { const c = visit(t); if (c) return c; }
    path.pop();
    return null;
  };
  for (const k of left) { const c = visit(k); if (c) return c; }
  return [...left];
}
