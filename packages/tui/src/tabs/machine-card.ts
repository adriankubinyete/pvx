import type { MachineSnap } from "@pvx/core";
import type { Glyphs } from "../theme.ts";
import { fmtUptime, levelOf, meter } from "./home.ts";

export type Tone = "dim" | "text" | "accent" | "warn" | "error" | "info";
/** A run of text with one color; a line is the runs that make up one row. */
export type Seg = [text: string, tone: Tone, bold?: boolean];
export type Line = Seg[];

const tone = (pct: number): Tone => ({ ok: "accent", warn: "warn", error: "error" } as const)[levelOf(pct)];
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** Pads or trims a line to exactly `w` cells, so it ends where the panel's inner edge is. */
export function fit(l: Line, w: number): Line {
  const out: Line = [];
  let left = w;
  for (const [t, k, b] of l) {
    if (left <= 0) break;
    const x = t.slice(0, left);
    out.push([x, k, b]);
    left -= x.length;
  }
  if (left > 0) out.push([" ".repeat(left), "dim"]);
  return out;
}

/**
 * A graph of `values` (0..100, oldest first) as `rows` text rows, top row first, `cells` wide. The history is stretched to the width.
 * Braille: 2 values per cell and 4 dot levels per row; otherwise one block character per cell, 8 levels per row. A value is never below level 1 (a baseline).
 */
export function graph(values: readonly number[], cells: number, rows: number, g: Pick<Glyphs, "braille" | "blocks">): string[] {
  const braille = Boolean(g.braille);
  const cols = braille ? cells * 2 : cells;
  const per = braille ? 4 : 8;
  const max = per * rows;
  const level = (k: number) => {
    const v = values.length ? values[Math.min(values.length - 1, Math.floor((k * values.length) / cols))]! : 0;
    return Math.max(1, Math.min(max, Math.round((v / 100) * max)));
  };
  const lv = Array.from({ length: cols }, (_, k) => level(k));
  const LEFT = [0x00, 0x40, 0x44, 0x46, 0x47];
  const RIGHT = [0x00, 0x80, 0xa0, 0xb0, 0xb8];
  const out: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    const n = (k: number) => Math.max(0, Math.min(per, lv[k]! - per * r));
    let s = "";
    for (let i = 0; i < cells; i++) {
      if (braille) {
        const bits = LEFT[n(2 * i)]! + RIGHT[n(2 * i + 1)]!;
        s += bits ? String.fromCharCode(0x2800 + bits) : " ";
      } else s += n(i) ? g.blocks[n(i) - 1]! : " ";
    }
    out.push(s);
  }
  return out;
}

const rate = (b: number) => (b < 1024 ? `${Math.round(b)} B/s` : b < 1048576 ? `${Math.round(b / 1024)} KB/s` : `${(b / 1048576).toFixed(1)} MB/s`);
const gib = (b: number) => b / 2 ** 30;
const num = (x: number, big: boolean) => (x === 0 ? "0" : big ? String(Math.round(x)) : x.toFixed(1));
const size = (u: { used: number; total: number }) => {
  const big = gib(u.total) >= 10;
  return `${num(gib(u.used), big)}/${num(gib(u.total), big)}G`;
};

const coreCols = (n: number) => (n > 16 ? 4 : 2);
const coreRows = (n: number) => Math.ceil(n / coreCols(n));
/** Inner width from which the card gets a second graph row and more top processes. */
export const WIDE_CARD = 90;

export interface CardPlan { graph2: boolean; swap: boolean; net: boolean; procs: boolean; rows: number }

/** What fits in `max` rows. Cores, memory, disk and the clock always stay; rows drop as: processes, network, second graph row, swap. */
export function planCard(cores: number, w: number, max: number): CardPlan {
  const p = { graph2: w >= WIDE_CARD, swap: true, net: true, procs: true, rows: 0 };
  const count = () => 1 + 1 + (p.graph2 ? 2 : 1) + coreRows(cores) + 1 + 2 + (p.swap ? 1 : 0) + (p.net ? 2 : 0) + (p.procs ? 1 : 0) + 1;
  for (const k of ["procs", "net", "graph2", "swap"] as const) if (count() > max) p[k] = false;
  p.rows = count();
  return p;
}

/** The card's rows, each exactly `w` cells wide. */
export function machineCard(m: MachineSnap, w: number, max: number, g: Glyphs): Line[] {
  const plan = planCard(m.cpu.cores.length, w, max);
  const out: Line[] = [];
  const sep = (title: string): Line => [[`${g.hline} ${title} `, "dim"], [g.hline.repeat(Math.max(0, w - title.length - 3)), "dim"]];
  const bar = (pct: number, n: number): Line => {
    const [full, empty] = meter(pct, Math.max(1, n), g);
    return [[full, tone(pct)], [empty, "dim"]];
  };
  const pct = (x: number) => `${Math.round(x)}%`;

  const host = cut(m.host, w);
  const where = [m.ip, m.os.replace(/ (GNU\/)?Linux/, ""), `up ${fmtUptime(m.uptime).split(" ")[0]}`].filter(Boolean).join(` ${g.sep} `);
  out.push(fit([[host, "text", true], [cut(`  ${where}`, w - host.length), "dim"]], w));

  out.push(fit(sep("cpu"), w));
  const [l1, l5, l15] = m.cpu.load.map((x) => x.toFixed(2));
  const right = `${pct(m.cpu.total).padStart(4)} ${g.sep} carga ${l1} ${l5} ${l15}`;
  const gw = Math.max(4, w - right.length - 1);
  graph(m.cpu.history, gw, plan.graph2 ? 2 : 1, g).forEach((row, i) =>
    out.push(fit([[row, tone(m.cpu.total)], ...(i === 0 ? ([[` ${right}`, "text"]] as Line) : [])], w)));

  // Cores fill column by column; each cell is `idx bar [pct]`, the last column takes the rounding remainder.
  const n = m.cpu.cores.length;
  const cols = coreCols(n);
  const rows = coreRows(n);
  const gap = 2;
  const cw = Math.floor((w - gap * (cols - 1)) / cols);
  const idxW = String(n - 1).length;
  for (let r = 0; r < rows; r++) {
    const line: Line = [];
    for (let c = 0; c < cols; c++) {
      const i = c * rows + r;
      const width = c === cols - 1 ? w - (cols - 1) * (cw + gap) : cw;
      if (c) line.push([" ".repeat(gap), "dim"]);
      if (i >= n) { line.push([" ".repeat(width), "dim"]); continue; }
      const p = m.cpu.cores[i]!;
      const label = cols === 2 ? ` ${pct(p).padStart(4)}` : "";
      line.push([String(i).padStart(idxW), "dim"], [" ", "dim"], ...bar(p, width - idxW - 1 - label.length));
      if (label) line.push([label, "text", true]);
    }
    out.push(fit(line, w));
  }

  out.push(fit(sep(`memória ${g.sep} disco`), w));
  const usage = (label: string, u: { used: number; total: number } | undefined, rt: string): Line => {
    const lab: Seg = [label.padEnd(6), "dim"];
    if (!u) return [lab, ["n/d", "dim"]];
    const p = u.total ? (u.used / u.total) * 100 : 0;
    return [lab, ...bar(p, w - 6 - rt.length), [rt, "text", true]];
  };
  const mem = [["mem", m.mem], ...(plan.swap ? [["swap", m.swap]] : []), ["disco", m.disk]] as [string, { used: number; total: number } | undefined][];
  const rts = mem.map(([, u]) => (u ? `  ${pct(u.total ? (u.used / u.total) * 100 : 0).padStart(4)}  ${size(u)}` : ""));
  const rtW = Math.max(...rts.map((x) => x.length));
  mem.forEach(([label, u], i) => out.push(fit(usage(label, u, rts[i]!.padStart(rtW)), w)));

  if (plan.net) {
    out.push(fit(sep(`rede ${g.sep} processos`), w));
    const nl: Line = m.net
      ? [[m.net.iface, "dim"], [`  ${g.down} ${rate(m.net.rx)}  ${g.up} ${rate(m.net.tx)}`, "info"]]
      : [["rede n/d", "dim"]];
    if (m.procs !== undefined) nl.push([`  ${m.procs} proc`, "text"]);
    out.push(fit(nl, w));
    if (plan.procs) {
      const top = (m.top ?? []).slice(0, w >= WIDE_CARD ? 5 : 3);
      out.push(fit(m.top ? (top.length ? top.flatMap((t, i): Line => [[`${i ? "  " : ""}${cut(t.name, 15)} `, "dim"], [pct(t.pct), tone(t.pct)]]) : [["ocioso", "dim"]]) : [["processos n/d", "dim"]], w));
    }
  }
  const at = `atualizado ${new Date(m.at).toTimeString().slice(0, 8)}`;
  out.push(fit([[" ".repeat(Math.max(0, w - at.length)) + at, "dim"]], w));
  return out;
}
