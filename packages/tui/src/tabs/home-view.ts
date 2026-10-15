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
const CORE_GAP_W = 3;
/** The least cells of a core bar with its label (the brackets and the percentage included); it gives 4 columns at 120 and 2 at 80. */
const CORE_BAR_MIN_W = 26;
/** The widest line of the right half: the network rates. */
export const RIGHT_W = 36;
/** Cells between the two halves under the cores. */
const HALVES_GAP_W = 4;

export interface MachineLayout {
  /** The facts sit on the right half; otherwise they go under the bars. */
  beside: boolean;
  /** Columns of core bars, filled column by column. */
  columns: number;
  /** Rows of core bars in each column. */
  rows: number;
  /** Cells between the brackets of a core bar. */
  coreInner: number;
  /** Cells between the brackets of the memory, swap and disk bars. */
  usedInner: number;
}

/** Cells between the brackets of a bar that takes `cells` with its label. */
const innerOf = (cells: number): number => cells - BAR_LABEL_W - BRACKETS_W;

/** As many columns as fit the minimum bar width, never more than there are cores. */
const columnsFor = (width: number, cores: number): number => {
  const fit = Math.floor((width + CORE_GAP_W) / (CORE_BAR_MIN_W + CORE_GAP_W));
  return Math.max(1, Math.min(cores, fit));
};

/**
 * The cores fill the width first, as htop does: `rows = ceil(cores / columns)` and the bars stretch to their column.
 * Memory, swap and disk take the left half and the facts the right half; when that half is narrower than the facts, they go under the bars.
 */
export function machineLayout(width: number, cores: number): MachineLayout {
  const rows = Math.ceil(cores / columnsFor(width, cores));
  const columns = Math.ceil(cores / rows);
  const columnWidth = Math.floor((width - CORE_GAP_W * (columns - 1)) / columns);
  const half = Math.floor((width - HALVES_GAP_W) / 2);
  const beside = half >= RIGHT_W;
  return { beside, columns, rows, coreInner: innerOf(columnWidth), usedInner: innerOf(beside ? half : width) };
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
