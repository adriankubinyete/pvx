import type { CommandSummary, ReviewFile } from "@pvx/core";

const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** `dd/mm/aaaa HH:MM` in local time, plus ` (hoje)` or ` (ontem)`. */
export function fmtWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ago = Math.round((day(now) - day(d)) / 86_400_000);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}${ago === 0 ? " (hoje)" : ago === 1 ? " (ontem)" : ""}`;
}

/** `owner/repo` (the last two path words) of a git URL or path; the URL itself when it has fewer. */
export function repoOf(url?: string): string {
  if (!url) return "(local)";
  const parts = url.replace(/\.git\/?$/, "").split(/[\\/:]+/).filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : url;
}

export type FileRow = { kind: "head"; group: string; count: number; lines: number; hits: number } | { kind: "file"; file: ReviewFile; name: string };

/** Files (already sorted by group) as group header rows followed by their files; names are relative to the group. */
export function fileRows(files: readonly ReviewFile[]): FileRow[] {
  const rows: FileRow[] = [];
  let last: string | undefined;
  for (const f of files) {
    if (f.group !== last) {
      last = f.group;
      const same = files.filter((x) => x.group === f.group);
      rows.push({ kind: "head", group: f.group, count: same.length, lines: same.reduce((n, x) => n + x.lines, 0), hits: same.reduce((n, x) => n + x.hits.length, 0) });
    }
    rows.push({ kind: "file", file: f, name: f.group === "." ? f.path : f.path.slice(f.group.length) });
  }
  return rows;
}

/** Hits grouped by message, in order of first appearance, with their distinct sorted line numbers. */
export function hitGroups(hits: ReviewFile["hits"]): { msg: string; lines: number[] }[] {
  const by = new Map<string, number[]>();
  for (const h of hits) by.set(h.msg, [...(by.get(h.msg) ?? []), h.line]);
  return [...by].map(([msg, ls]) => ({ msg, lines: [...new Set(ls)].sort((a, b) => a - b) }));
}

/** `linhas 38, 40 e 55`; long lists end with `e mais N`. */
export function linesText(lines: number[], max = 6): string {
  const word = lines.length === 1 ? "linha" : "linhas";
  if (lines.length > max) return `${word} ${lines.slice(0, max).join(", ")} e mais ${lines.length - max}`;
  return `${word} ${lines.length > 1 ? `${lines.slice(0, -1).join(", ")} e ${lines.at(-1)}` : lines[0]}`;
}

/** Marks (true) among `width` cells where the hits fall, proportional to the file length. */
export function rulerMarks(total: number, hits: number[], width: number): boolean[] {
  const cells = Array<boolean>(width).fill(false);
  for (const l of hits) cells[total <= 1 ? 0 : Math.min(width - 1, Math.round(((l - 1) / (total - 1)) * (width - 1)))] = true;
  return cells;
}

export type Seg = [text: string, tone: "text" | "info" | "dim"];

/** The `entrega` line: commands (with groups), pages and widgets; empty parts are left out. Numbers are `info`. */
export function deliverySegs(cmds: CommandSummary, pages: number, widgets: number): Seg[] {
  const parts: Seg[][] = [];
  if (cmds.total) {
    const inner = [...cmds.groups.map((g) => `${g.name} ${g.count}`), ...(cmds.singles.length ? [`+${cmds.singles.length} avulsos`] : [])];
    parts.push([[String(cmds.total), "info"], [` ${cmds.total === 1 ? "comando" : "comandos"}`, "text"], ...(cmds.groups.length ? [[` (${inner.join(" · ")})`, "dim"] as Seg] : [])]);
  }
  if (pages) parts.push([[String(pages), "info"], [` ${pages === 1 ? "página" : "páginas"}`, "text"]]);
  if (widgets) parts.push([[String(widgets), "info"], [` ${widgets === 1 ? "widget" : "widgets"}`, "text"]]);
  return parts.flatMap((p, i) => (i ? [[" · ", "dim"] as Seg, ...p] : p));
}
