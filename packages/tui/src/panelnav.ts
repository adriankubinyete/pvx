import { useRef } from "react";

export interface Rect { x: number; y: number; width: number; height: number }
export type Dir = "left" | "right" | "up" | "down";

/**
 * The nearest panel in `dir` from `current`, by rendered rectangles (pass only navigable panels).
 * A candidate's centre must lie beyond the current edge; overlap on the perpendicular axis wins, then the smallest gap.
 */
export function pickPanel(rects: Record<string, Rect>, current: string, dir: Dir): string | undefined {
  const cur = rects[current];
  if (!cur) return undefined;
  const horiz = dir === "left" || dir === "right";
  // Main axis (along the move) and cross axis (perpendicular), as [start, size].
  const main = (r: Rect): [number, number] => (horiz ? [r.x, r.width] : [r.y, r.height]);
  const cross = (r: Rect): [number, number] => (horiz ? [r.y, r.height] : [r.x, r.width]);
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  const [cm, cs] = main(cur);
  const [xs, xl] = cross(cur);
  let best: { id: string; score: [number, number, number] } | undefined;
  for (const [id, r] of Object.entries(rects)) {
    if (id === current) continue;
    const [m, s] = main(r);
    const centre = m + s / 2;
    if (sign > 0 ? centre <= cm + cs : centre >= cm) continue;
    const [ys, yl] = cross(r);
    const overlap = Math.min(xs + xl, ys + yl) - Math.max(xs, ys) > 0;
    const gap = Math.abs(sign > 0 ? m - (cm + cs) : cm - (m + s));
    const score: [number, number, number] = [overlap ? 0 : 1, gap, Math.abs(ys + yl / 2 - (xs + xl / 2))];
    if (!best || cmp(score, best.score) < 0) best = { id, score };
  }
  return best?.id;
}
const cmp = (a: number[], b: number[]) => a.reduce((d, v, i) => d || v - b[i]!, 0);

/** Two-level focus: on a panel as a whole (`inside` false) or on the items inside it. */
export interface Focus { panel: string; inside: boolean }
export type Step = Focus & {
  /** Inside: move the selection by this much (the caller owns the list and its edges). */
  move?: -1 | 1;
  /** Inside: enter on the selected item. */
  act?: true;
  /** Panel level, up with nothing above: the caller sends focus to the tab bar (or nudges). */
  bar?: true;
  nudge?: string;
};

/**
 * One key of the two-level rule. Panel level: arrows pick the panel on that side; enter goes inside a panel that has
 * items (`size` > 0). Inside: up/down move the selection, enter acts, esc goes back to the panel. Undefined: not handled.
 */
export function panelStep(f: Focus, key: Dir | "enter" | "esc", pick: (panel: string, dir: Dir) => string | undefined, size: (panel: string) => number): Step | undefined {
  if (f.inside) {
    if (key === "esc") return { ...f, inside: false };
    if (key === "enter") return { ...f, act: true };
    return key === "up" || key === "down" ? { ...f, move: key === "up" ? -1 : 1 } : { ...f, nudge: "esc sai do painel" };
  }
  if (key === "esc") return undefined;
  if (key === "enter") return size(f.panel) > 0 ? { ...f, inside: true } : { ...f, nudge: "nada para selecionar" };
  const to = pick(f.panel, key);
  if (to) return { panel: to, inside: false };
  return key === "up" ? { ...f, bar: true } : { ...f, nudge: "nada aqui" };
}

/** `index` moved by `delta` inside a list of `count` rows, wrapping at both ends (`count` 0 gives 0). */
export function wrap(index: number, delta: number, count: number): number {
  return count > 0 ? (((index + delta) % count) + count) % count : 0;
}

/** Layout of a renderable after layout (`x`/`y`/`width`/`height`). */
interface Laid { x: number; y: number; width: number; height: number }

/** Keeps the live rectangles of the panels that report one; `pick` reads them at key time, so a resize needs no bookkeeping. */
export function usePanelNav() {
  const refs = useRef(new Map<string, Laid>());
  return useRef(makeNav(refs.current)).current;
}

function makeNav(refs: Map<string, Laid>) {
  const pick = (current: string, dir: Dir, only?: readonly string[]) => {
    const rects: Record<string, Rect> = {};
    for (const [id, r] of refs) if (!only || only.includes(id)) rects[id] = { x: r.x, y: r.y, width: r.width, height: r.height };
    return pickPanel(rects, current, dir);
  };
  return {
    /** `ref={nav.ref(id)}` on the panel's box. Only mounted panels count. */
    ref: (id: string) => (r: Laid | null) => void (r ? refs.set(id, r) : refs.delete(id)),
    pick,
    wrap,
    step: (f: Focus, key: Dir | "enter" | "esc", size: (panel: string) => number) => panelStep(f, key, pick, size),
  };
}
export type PanelNav = ReturnType<typeof usePanelNav>;
