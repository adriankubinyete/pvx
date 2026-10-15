// What the value primitives draw (Badge, Details, Meter, Spark), as pure functions: no UI, so they test without rendering.
import type { DetailItem } from "@pvx/sdk";
import { WIDE_COLS } from "../layout.ts";
import { fixedPercent } from "../fixed.ts";
import { graph } from "../graph.ts";
import type { Glyphs } from "../theme.ts";

const cellsOf = (text: string): number => [...text].length;

/** Share of a `Meter` above which the bar turns to the warn color. */
export const METER_WARN_ABOVE = 0.8;

/** The two halves of a meter bar: the filled cells and the empty ones, `width` cells in all. */
export function meterBar(value: number, width: number, g: Pick<Glyphs, "barFull" | "barEmpty">): { filled: string; empty: string } {
  const share = Math.max(0, Math.min(1, value));
  const lit = Math.round(share * width);
  return { filled: g.barFull.repeat(lit), empty: g.barEmpty.repeat(width - lit) };
}

/** `accent` normally, `warn` above `warnAbove`. */
export const meterTone = (value: number, warnAbove: number = METER_WARN_ABOVE): "accent" | "warn" => (value > warnAbove ? "warn" : "accent");

/** `41%`, three cells wide so a column of meters lines up. */
export const percentText = (value: number): string => `${String(Math.round(Math.max(0, Math.min(1, value)) * 100)).padStart(3)}%`;

/** The one text row of a series: `▁▂▃▅`, oldest first, stretched to `width` cells. Values run from 0 to `max`. */
export function sparkText(values: readonly number[], width: number, max: number, g: Pick<Glyphs, "blocks">): string {
  const scaled = values.map((value) => (max > 0 ? (Math.max(0, value) / max) * 100 : 0));
  return graph(scaled, width, 1, { braille: "", blocks: g.blocks })[0]!;
}

/** The text after a spark: the last value as a percentage when the series is a percentage, else nothing. */
export function sparkSuffix(values: readonly number[], max: number): string {
  const last = values.at(-1);
  if (last === undefined || max !== 100) return "";
  return fixedPercent(last);
}

/** Columns between the two columns of `Details`. */
export const DETAILS_GAP = 4;
/** Columns between a label and its value. */
const LABEL_GAP = 2;

/** One column of `Details`: its items and the widths they line up to. */
export interface DetailColumn {
  items: DetailItem[];
  labelWidth: number;
  /** The widest value with its note. */
  valueWidth: number;
}

const valueCells = (item: DetailItem): number => cellsOf(item.value) + (item.note ? 1 + cellsOf(item.note) : 0);

export function columnOf(items: DetailItem[]): DetailColumn {
  return { items, labelWidth: Math.max(0, ...items.map((item) => cellsOf(item.label))), valueWidth: Math.max(0, ...items.map(valueCells)) };
}

/** Two columns only when asked for and the terminal is wide (100 columns); otherwise one. */
export const detailColumnCount = (wanted: 1 | 2, cols: number): 1 | 2 => (wanted === 2 && cols >= WIDE_COLS ? 2 : 1);

/** The items by row: with two columns the items alternate (first left, second right, third left…). */
export function detailColumns(items: DetailItem[], count: 1 | 2): DetailColumn[] {
  if (count === 1) return [columnOf(items)];
  return [columnOf(items.filter((_, index) => index % 2 === 0)), columnOf(items.filter((_, index) => index % 2 === 1))];
}

/** Cells from the start of a column to where its value starts. */
export const valueOffset = (column: DetailColumn): number => column.labelWidth + LABEL_GAP;
/** Cells a column takes, so the next one starts at the same place on every row. */
export const columnWidth = (column: DetailColumn): number => valueOffset(column) + column.valueWidth;

/** Rows of text of a label/value block for the clipboard: `label  value`, labels padded to the widest. */
export function copyText(rows: DetailItem[]): string {
  const { labelWidth } = columnOf(rows);
  return rows.map((row) => `${row.label.padEnd(labelWidth)}${" ".repeat(LABEL_GAP)}${row.value}`.trimEnd()).join("\n");
}
