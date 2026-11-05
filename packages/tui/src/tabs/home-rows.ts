// The rows of the three sections of Início, as plain data: the component only draws them.
import type { HomeNote, Tone } from "@pvx/sdk";
import { clean } from "../palette/search.ts";
import type { Glyphs } from "../theme.ts";
import { activity, relTime, type Att, type Chip, type Level } from "./home.ts";

/** The row that starts a note. */
export const NEW_NOTE_ROW_ID = "nova";
/** Label of the button that takes an attention item's fix to the Comando. */
export const FIX_BUTTON = "corrigir";
export const NEW_NOTE_TEXT = "+ nova nota";

export interface HomeRow {
  id: string;
  /** A result marker (`[!]`) in the color of the level. */
  level?: Level | "info";
  /** A single glyph and its tone, for rows that are not results. */
  glyph?: [text: string, tone: Tone];
  text: string;
  /** Dim, right aligned. */
  note?: string;
  /** What enter puts in the Comando input; without it enter does nothing on the row. */
  use?: string;
  /** The button at the end of the row. */
  button?: string;
  /** The row is an action, drawn in the accent. */
  action?: boolean;
  /** The text is dim: something not done yet, not something wrong. */
  dim?: boolean;
  /** When it happened (ms), for a row of the activity. */
  at?: number;
  /** The command line that removes the row (a note); `enter` runs it and the session asks first. */
  remove?: string;
}

/** The row that says the memory is nearly full. */
export const MEMORY_ROW_ID = "memoria-alta";
/** Above this share of memory in use the Atenção says so. */
export const MEMORY_WARN_SHARE = 0.9;
/** What enter on the memory row puts in the Comando: the shell mode, with the process monitor. */
const PROCESS_COMMAND = "!top";

/** One row per item that needs attention, plus one for each widget that broke. */
export function attentionRows(items: readonly Att[], brokenWidgets: readonly string[]): HomeRow[] {
  const rows = items.map((item): HomeRow => ({ id: item.title, level: item.level, text: item.title, use: item.fix, button: item.fix ? FIX_BUTTON : undefined }));
  const broken = brokenWidgets.map((id): HomeRow => ({ id: `broken:${id}`, level: "warn", text: `widget quebrou: ${id}` }));
  return [...rows, ...broken];
}

/** The notices of the modules and the host (an embedded copy that won, a widget summary) as rows: terse, with the glyph of their level. */
export function chipRows(chips: readonly Chip[], brokenChips: readonly string[]): HomeRow[] {
  const rows = chips.map((chip): HomeRow => ({ id: `chip:${chip.label}`, level: chip.level === "ok" ? "info" : chip.level, text: chip.detail ? `${clean(chip.label)}: ${clean(chip.detail)}` : clean(chip.label) }));
  const broken = brokenChips.map((id): HomeRow => ({ id: `broken:${id}`, level: "warn", text: `widget quebrou: ${id}` }));
  return [...rows, ...broken];
}

/** `memória em 99%` with the button that opens the process monitor; no row while the memory has room. */
export function memoryRows(mem: { used: number; total: number } | undefined): HomeRow[] {
  if (!mem?.total || mem.used / mem.total < MEMORY_WARN_SHARE) return [];
  return [{ id: MEMORY_ROW_ID, level: "warn", text: `memória em ${Math.round((mem.used / mem.total) * 100)}%`, use: PROCESS_COMMAND, button: "ver processos" }];
}

/** `6 capacidades em dia`, `1 capacidade em dia`; nothing at zero. */
export function upToDateText(count: number): string | undefined {
  if (count === 0) return undefined;
  return `${count} ${count === 1 ? "capacidade" : "capacidades"} em dia`;
}

/** `16/10`, local time. */
export function dayMonth(at: string): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** `16/10  texto  — assinatura`: the text on one line, the signature when there is one. */
export function noteText(note: HomeNote): string {
  const text = clean(note.text).replace(/\n+/g, " ").trim();
  const signature = note.signature ? `  — ${clean(note.signature)}` : "";
  return `${dayMonth(note.at)}  ${text}${signature}`;
}

/** The notes as rows, newest first (the slot's order), and `+ nova nota` after them when something can write one. `removeLine` is the command that removes a note, to which its number is added. */
export function noteRows(notes: readonly HomeNote[], canCompose: boolean, removeLine?: string): HomeRow[] {
  const rows = notes.map((note): HomeRow => ({ id: `note:${note.n}`, text: noteText(note), remove: removeLine ? `${removeLine} ${note.n}` : undefined }));
  return canCompose ? [...rows, { id: NEW_NOTE_ROW_ID, text: NEW_NOTE_TEXT, action: true }] : rows;
}

/** Favorites first, then the latest commands; each knows when it ran when this session ran it. */
export function activityRows(history: readonly string[], blocks: Parameters<typeof activity>[1], favorites: readonly string[], now: number, g: Pick<Glyphs, "favorite" | "error" | "warn" | "ok">): HomeRow[] {
  return activity(history, blocks, favorites).map((entry): HomeRow => ({
    id: entry.id,
    glyph: activityGlyph(entry.favorite, entry.status, g),
    text: clean(entry.line),
    note: entry.at ? relTime(entry.at, now) : undefined,
    at: entry.at,
    use: entry.line,
  }));
}

const GLYPH_BY_STATUS = (g: Pick<Glyphs, "error" | "warn" | "ok">): Record<string, [string, Tone]> => ({
  error: [g.error, "error"],
  warn: [g.warn, "warn"],
  ok: [g.ok, "ok"],
});

function activityGlyph(favorite: boolean, status: string | undefined, g: Pick<Glyphs, "favorite" | "error" | "warn" | "ok">): [string, Tone] {
  if (favorite) return [g.favorite, "warn"];
  return GLYPH_BY_STATUS(g)[status ?? ""] ?? [" ", "dim"];
}

/** `text` cut to `width` cells, ending in `…` when it did not fit. */
export function truncate(text: string, width: number): string {
  const cells = [...text];
  if (cells.length <= width) return text;
  return `${cells.slice(0, Math.max(0, width - 1)).join("")}…`;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** The one line of the activity: `17:20 alfa confirm · 17:19 alfa ip accept 1.1.1.1`, cut to `width`; `nenhuma` when nothing ran. */
export function activitySummary(rows: readonly HomeRow[], width: number): string {
  if (!rows.length) return "nenhuma";
  const parts = rows.map((row) => {
    const time = row.at === undefined ? "" : `${p2(new Date(row.at).getHours())}:${p2(new Date(row.at).getMinutes())} `;
    return `${time}${row.text}`;
  });
  return truncate(parts.join(" · "), width);
}

/** The one line of the notes: the latest one, or `nenhuma`. */
export function notesSummary(rows: readonly HomeRow[], width: number): string {
  const first = rows.find((row) => !row.action);
  return first ? truncate(first.text, width) : "nenhuma";
}
