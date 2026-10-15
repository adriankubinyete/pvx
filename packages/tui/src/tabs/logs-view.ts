// What the Logs tab shows, as pure functions: filter, group by day, time and level words. No UI, so they test without rendering.
import type { LogEntry, LogLevel } from "@pvx/core";
import { LOG_LEVELS } from "@pvx/core";
import { clean } from "../palette/search.ts";

/** The logger of the host is `core`; the technician reads it as `pvx`. */
export const HOST_SOURCE = "core";
export const HOST_LABEL = "pvx";
export const AUDIT_SOURCE = "audit";
/** The chip that keeps every source. */
export const ALL_SOURCES = "todos";

export const sourceLabel = (source: string): string => (source === HOST_SOURCE ? HOST_LABEL : source);

/** The level chips, quietest first: each keeps its own level and the ones above. */
export const LEVEL_CHIPS: readonly { level: LogLevel; label: string }[] = [
  { level: "debug", label: "debug+" },
  { level: "info", label: "info+" },
  { level: "warn", label: "aviso+" },
  { level: "error", label: "erro" },
];
export const DEFAULT_LEVEL: LogLevel = "info";

export const levelChipLabel = (level: LogLevel): string => LEVEL_CHIPS.find((chip) => chip.level === level)!.label;

/** The level after `level` in the chips, wrapping. */
export function nextLevel(level: LogLevel): LogLevel {
  const index = LEVEL_CHIPS.findIndex((chip) => chip.level === level);
  return LEVEL_CHIPS[(index + 1) % LEVEL_CHIPS.length]!.level;
}

/** The sources to filter by, in the order of the chips: `todos`, the host, then every module that wrote, sorted. */
export function sourceChips(entries: readonly LogEntry[], moduleIds: readonly string[]): string[] {
  const modules = new Set([...moduleIds, ...entries.map((entry) => entry.source)]);
  modules.delete(HOST_SOURCE);
  modules.delete(AUDIT_SOURCE);
  return [ALL_SOURCES, HOST_SOURCE, ...[...modules].sort()];
}

/** The chip after (or before) `source`, wrapping; a source that went away starts again from `todos`. */
export function stepSource(chips: readonly string[], source: string, delta: number): string {
  const index = Math.max(0, chips.indexOf(source));
  return chips[(index + delta + chips.length) % chips.length]!;
}

export interface LogFilter {
  source: string;
  level: LogLevel;
  search: string;
}

const rankOf = (level: LogLevel): number => LOG_LEVELS.indexOf(level);

/** The entries of the chosen source at the chosen level or above whose source or message have the search text (case and accents aside). */
export function filterEntries(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  const term = fold(filter.search.trim());
  return entries.filter((entry) => {
    if (filter.source !== ALL_SOURCES && entry.source !== filter.source) return false;
    if (rankOf(entry.level) < rankOf(filter.level)) return false;
    if (!term) return true;
    return fold(`${sourceLabel(entry.source)} ${entry.message}`).includes(term);
  });
}

const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** An entry with the id the cursor keeps: its time and source, and which of the entries with those it is. */
export interface LogLine {
  id: string;
  entry: LogEntry;
}

export function withIds(entries: readonly LogEntry[]): LogLine[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = `${entry.at}:${entry.source}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { id: `${base}:${count}`, entry };
  });
}

/** The words after the time and the source: only a warning or an error says its level. */
export const LEVEL_WORD: Partial<Record<LogLevel, string>> = { warn: "aviso", error: "erro" };

const p2 = (n: number) => String(n).padStart(2, "0");
/** `13:39:04`, local time. */
export function timeText(at: number): string {
  const date = new Date(at);
  return `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** `hoje`, `ontem`, `14/10`, or `14/10/2025` for another year. */
export function dayLabel(at: number, now: number): string {
  const day = new Date(at);
  if (sameDay(day, new Date(now))) return "hoje";
  if (sameDay(day, new Date(now - DAY_MS))) return "ontem";
  const date = `${p2(day.getDate())}/${p2(day.getMonth() + 1)}`;
  return day.getFullYear() === new Date(now).getFullYear() ? date : `${date}/${day.getFullYear()}`;
}

/** The lines in order with a heading before the first of each day. */
export type LogRow = { kind: "day"; id: string; label: string } | { kind: "line"; id: string; line: LogLine };

export function groupByDay(lines: readonly LogLine[], now: number): LogRow[] {
  const rows: LogRow[] = [];
  let current = "";
  for (const line of lines) {
    const label = dayLabel(line.entry.at, now);
    if (label !== current) {
      rows.push({ kind: "day", id: `day:${label}`, label });
      current = label;
    }
    rows.push({ kind: "line", id: line.id, line });
  }
  return rows;
}

/** The newest lines kept on screen: a thousand rows of text cost more than they help. */
export const MAX_SHOWN = 500;

/** The phase a job was in at `at`: the one that had started and not ended. */
export function phaseAt(task: { phases?: { phases: { label: string; startedAt?: number; endedAt?: number }[] } }, at: number): string | undefined {
  const phase = task.phases?.phases.find((candidate) => candidate.startedAt !== undefined && candidate.startedAt <= at && (candidate.endedAt === undefined || at <= candidate.endedAt));
  return phase ? clean(phase.label) : undefined;
}

/** `↳ fase dump · tarefa backup-mysql-hora · enter mostra o log da tarefa`. */
export function jobHint(name: string, phase: string | undefined): string {
  return `↳ ${phase ? `fase ${phase} · ` : ""}tarefa ${clean(name)} · enter mostra o log da tarefa`;
}

/** The facts under an entry opened with enter: where and when it came from, the whole message and its detail. */
export function detailLines(entry: LogEntry): string[] {
  const when = new Date(entry.at);
  const date = `${when.getFullYear()}-${p2(when.getMonth() + 1)}-${p2(when.getDate())} ${timeText(entry.at)}`;
  return [`fonte  ${sourceLabel(entry.source)}`, `nível  ${LEVEL_CHIPS.find((chip) => chip.level === entry.level)!.label.replace("+", "")}`, `hora   ${date}`, `texto  ${clean(entry.message)}`, ...entry.detail.map((line) => `       ${clean(line)}`)];
}
