// What the machine block of Início says, as pure functions: no UI, so they test without rendering.
import type { MachineSnap } from "@pvx/core";
import { fixedNumber, fixedRate } from "../fixed.ts";
import type { Glyphs } from "../theme.ts";

const GIB = 2 ** 30;
const MIB = 2 ** 20;
const BIG_TOTAL_GIB = 10;
/** Cells of one load average (`1,8`, `12,3`, `4,00`). */
const LOAD_W = 4;

/** The decimal mark of the technician's language. */
export const decimalComma = (text: string): string => text.replace(".", ",");

/** The total of a memory or disk: `4`, `1,9`, `44`. It never changes, so it gives the width of the used part. */
function totalText(totalGib: number): string {
  if (totalGib >= BIG_TOTAL_GIB) return String(Math.round(totalGib));
  return decimalComma(String(Number(totalGib.toFixed(1))));
}

/** `7,9/8G`, the used part padded to the widest it gets, so the text keeps its width as the use grows. */
export function sizeText(used: number, total: number): string {
  const totalGib = total / GIB;
  const usedGib = used / GIB;
  const totalLabel = totalText(totalGib);
  const big = totalGib >= BIG_TOTAL_GIB;
  const usedLabel = big ? String(Math.round(usedGib)) : decimalComma(usedGib.toFixed(1));
  const usedWidth = big ? totalLabel.length : Math.max(totalLabel.length, String(Math.floor(totalGib)).length + 2);
  return `${usedLabel.padStart(usedWidth)}/${totalLabel}G`;
}

/** Cells `sizeText` takes for a total (the width of its widest form). */
export const sizeWidth = (total: number): number => sizeText(total, total).length;

/** `↓   2,1 MB/s  ↑   340 KB/s`: both rates in a fixed width. */
export function rateText(net: NonNullable<MachineSnap["net"]>, g: Pick<Glyphs, "down" | "up">): string {
  return decimalComma(`${g.down} ${fixedRate(net.rx)}  ${g.up} ${fixedRate(net.tx)}`);
}

/** The three load averages as strings of one width, the first one apart because the page draws it in bold. */
export function loadParts(load: readonly number[]): { first: string; rest: string } {
  const [first = 0, ...rest] = load.map((value) => decimalComma(fixedNumber(value, { width: LOAD_W, decimals: 2 })));
  return { first: String(first), rest: rest.join(" ") };
}

/** `1d 6h 42m`, `6h 42m`, `42m`. */
export function uptimeText(seconds: number): string {
  const minutes = Math.floor(seconds / 60) % 60;
  const hours = Math.floor(seconds / 3600) % 24;
  const days = Math.floor(seconds / 86400);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** `88 · 1 rodando`: the counts in a fixed width. Without the run queue, only the total. */
export function processesText(procs: number, running: number | undefined): string {
  const total = fixedNumber(procs, { width: 4 });
  if (running === undefined) return total;
  return `${total} · ${fixedNumber(running, { width: 3 })} rodando`;
}

/** `55 MB`, `1,2 GB`, in a fixed 7 cells. */
export function memoryText(bytes: number): string {
  const text = bytes >= GIB ? `${decimalComma((bytes / GIB).toFixed(1))} GB` : `${Math.round(bytes / MIB)} MB`;
  return text.padStart(7);
}

const TOP_NAME_W = 10;
const TOP_SHOWN = 3;

/** The heaviest processes, one line each: the name, the cpu share and the resident memory, in fixed widths. */
export function heaviestLines(top: MachineSnap["top"]): string[] {
  return (top ?? []).slice(0, TOP_SHOWN).map((proc) => {
    const name = [...proc.name].slice(0, TOP_NAME_W).join("").padEnd(TOP_NAME_W);
    const share = `${decimalComma(fixedNumber(proc.pct, { width: 4, decimals: 1 }))}%`;
    return `${name} ${share}${proc.mem === undefined ? "" : ` ${memoryText(proc.mem)}`}`;
  });
}

/** Cells of a label before a bar (`mem`, `swp`, `dsk` and the index of a core up to 999). */
export const BAR_LABEL_W = 3;
/** The brackets of a bar. */
const BRACKETS_W = 2;
/** Cells of a bar with its label: the label, the brackets and what is between them. */
export const barCellWidth = (inner: number): number => BAR_LABEL_W + BRACKETS_W + inner;

const INNER_MAX = 30;
const INNER_MIN = 10;
const CORES_PER_COLUMN = 8;
const SUB_GAP_W = 3;
const COLUMNS_GAP_W = 4;
/** The widest line of the right column: the network rates. */
export const RIGHT_W = 36;
/** Lines of the right column when it has everything: the host, six facts, a blank, the heading and three processes. */
const FACT_LINES = 11;
/** Rows of memory, swap and disk under the cores. */
const USED_ROWS = 3;
/** Cells between the bar and its size (`dsk[...] 177/228G`). */
const SIZE_GAP_W = 1;

export interface MachineLayout {
  /** The right column sits beside the bars; otherwise it goes under them. */
  beside: boolean;
  /** Columns of core bars. */
  columns: number;
  /** Rows of core bars in each column. */
  rows: number;
  /** Cells between the brackets of every bar. */
  inner: number;
}

/** The bars of `width` cells: `columns` of up to eight cores, each `inner` wide (16 to 30), shrinking the width before the count. */
function barsIn(width: number, cores: number, sizeW: number): MachineLayout | undefined {
  const needed = Math.max(1, Math.ceil(cores / CORES_PER_COLUMN));
  const maxColumns = Math.floor((width + SUB_GAP_W) / (barCellWidth(INNER_MIN) + SUB_GAP_W));
  if (maxColumns < 1) return undefined;
  const columns = Math.min(needed, maxColumns);
  const share = Math.floor((width - SUB_GAP_W * (columns - 1)) / columns) - BAR_LABEL_W - BRACKETS_W;
  const withSize = width - BAR_LABEL_W - BRACKETS_W - SIZE_GAP_W - sizeW; // the first column also carries a size
  const inner = Math.min(INNER_MAX, share, withSize);
  if (inner < INNER_MIN) return undefined;
  return { beside: false, columns, rows: Math.ceil(cores / columns), inner };
}

/** The height of the block for a layout: beside, the taller of the two columns; stacked, the bars, a blank row and the facts. */
const heightOf = (layout: MachineLayout): number => {
  const bars = layout.rows + USED_ROWS;
  return layout.beside ? Math.max(bars, FACT_LINES) : bars + 1 + FACT_LINES;
};

/** Up to eight cores in a column; with more, another column (the bars get shorter before the columns get fewer). */
const columnsNeeded = (cores: number): number => Math.max(1, Math.ceil(cores / CORES_PER_COLUMN));

/**
 * Bars on the left and the facts on the right when the bars keep their columns of eight there; else the facts go under the bars, if that keeps them;
 * else the shorter of the two (a machine with too many cores for any width gets columns longer than eight).
 */
export function machineLayout(width: number, cores: number, sizeW: number): MachineLayout {
  const needed = columnsNeeded(cores);
  const beside = barsIn(width - COLUMNS_GAP_W - RIGHT_W, cores, sizeW);
  const stacked = barsIn(width, cores, sizeW) ?? { beside: false, columns: 1, rows: cores, inner: INNER_MIN };
  const side: MachineLayout | undefined = beside && { ...beside, beside: true };
  if (side && side.columns === needed) return side;
  if (stacked.columns === needed) return stacked;
  if (!side) return stacked;
  return heightOf(side) <= heightOf(stacked) ? side : stacked;
}

/** The cores by column: column-major, `rows` to a column. */
export function coreColumns(cores: readonly number[], rows: number): { index: number; value: number }[][] {
  const columns: { index: number; value: number }[][] = [];
  cores.forEach((value, index) => {
    const column = Math.floor(index / rows);
    (columns[column] ??= []).push({ index, value });
  });
  return columns;
}
