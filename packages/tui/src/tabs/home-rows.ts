// The rows of the three sections of Início, as plain data: the component only draws them.
import type { Tone } from "@pvx/sdk";
import { clean } from "../palette/search.ts";
import type { Glyphs } from "../theme.ts";
import { activity, relTime, type Att, type Conformity, type Level } from "./home.ts";

/** The row that holds the section's own buttons (plan, verify): one stop for the arrows, the buttons side by side inside it. */
export const ACTIONS_ROW_ID = "acoes";
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
}

/** One row per item that needs attention, plus one for each widget that broke. */
export function attentionRows(items: readonly Att[], brokenWidgets: readonly string[]): HomeRow[] {
  const rows = items.map((item): HomeRow => ({ id: item.title, level: item.level, text: item.title, use: item.fix, button: item.fix ? FIX_BUTTON : undefined }));
  const broken = brokenWidgets.map((id): HomeRow => ({ id: `broken:${id}`, level: "warn", text: `widget quebrou: ${id}` }));
  return [...rows, ...broken];
}

/** `6 capacidades em dia`, `1 capacidade em dia`; nothing at zero. */
export function upToDateText(count: number): string | undefined {
  if (count === 0) return undefined;
  return `${count} ${count === 1 ? "capacidade" : "capacidades"} em dia`;
}

/** The pending items someone ignored for 24 hours, as dim lines (their text already says until when). */
export const ignoredTexts = (done: Conformity | undefined): string[] => done?.ignored ?? [];

export function noteRows(notes: readonly string[], canCompose: boolean): HomeRow[] {
  const rows = notes.map((text, index): HomeRow => ({ id: `note:${index}`, text: clean(text) }));
  return canCompose ? [...rows, { id: NEW_NOTE_ROW_ID, text: NEW_NOTE_TEXT, action: true }] : rows;
}

/** Favorites first, then the latest commands; each knows when it ran when this session ran it. */
export function activityRows(history: readonly string[], blocks: Parameters<typeof activity>[1], favorites: readonly string[], now: number, g: Pick<Glyphs, "favorite" | "error" | "warn" | "ok">): HomeRow[] {
  return activity(history, blocks, favorites).map((entry): HomeRow => ({
    id: entry.id,
    glyph: activityGlyph(entry.favorite, entry.status, g),
    text: clean(entry.line),
    note: entry.at ? relTime(entry.at, now) : undefined,
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

/** `rodar o plano (3 passos)`. */
export const planButtonLabel = (steps: number): string => `rodar o plano (${steps} ${steps === 1 ? "passo" : "passos"})`;

/** The buttons of the actions row, in order: the plan when there is one to run, then the verification. */
export type HomeAction = "plan" | "verify";
export function actionButtons(planSteps: number, canRunPlan: boolean, checked: boolean): { action: HomeAction; label: string }[] {
  const verify = { action: "verify" as const, label: checked ? "verificar de novo" : "verificar" };
  if (!canRunPlan || planSteps === 0) return [verify];
  return [{ action: "plan", label: planButtonLabel(planSteps) }, verify];
}

/** `text` cut to `width` cells, ending in `…` when it did not fit. */
export function truncate(text: string, width: number): string {
  const cells = [...text];
  if (cells.length <= width) return text;
  return `${cells.slice(0, Math.max(0, width - 1)).join("")}…`;
}
