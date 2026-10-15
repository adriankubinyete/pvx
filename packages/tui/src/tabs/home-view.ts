// What the machine block of Início says, as pure functions: no UI, so they test without rendering.
import type { MachineSnap } from "@pvx/core";
import { fixedNumber, fixedRate } from "../fixed.ts";
import type { Glyphs } from "../theme.ts";
import { fmtUptime } from "./home.ts";

/** Cells of the dim label before a gauge (`memória` is the longest) and of the gap after it. */
export const GAUGE_LABEL_W = 7;
export const GAUGE_GAP_W = 2;
/** Cells from the left edge to where a gauge starts: the core grid lines up under the cpu line. */
export const GAUGE_INDENT_W = GAUGE_LABEL_W + GAUGE_GAP_W;

const GIB = 2 ** 30;
const BIG_TOTAL_GIB = 10;
/** Cells of one load average (`1,8`, `12,3`). */
const LOAD_W = 4;

/** The decimal mark of the technician's language. */
export const decimalComma = (text: string): string => text.replace(".", ",");

/** The total of a memory or disk: `4`, `1,9`, `44`. It never changes, so it gives the width of the used part. */
function totalText(totalGib: number): string {
  if (totalGib >= BIG_TOTAL_GIB) return String(Math.round(totalGib));
  return decimalComma(String(Number(totalGib.toFixed(1))));
}

/** `2,7 de 4 GB`, the used part padded to the widest it gets, so the text keeps its width as the use grows. */
export function usedOfText(used: number, total: number): string {
  const totalGib = total / GIB;
  const usedGib = used / GIB;
  const totalLabel = totalText(totalGib);
  const big = totalGib >= BIG_TOTAL_GIB;
  const usedLabel = big ? String(Math.round(usedGib)) : decimalComma(usedGib.toFixed(1));
  const usedWidth = big ? totalLabel.length : Math.max(totalLabel.length, String(Math.floor(totalGib)).length + 2);
  return `${usedLabel.padStart(usedWidth)} de ${totalLabel} GB`;
}

/** Cells `usedOfText` takes for a total (the width of its widest form). */
export const usedOfWidth = (total: number): number => usedOfText(total, total).length;

/** `↓   2,1 MB/s  ↑ 340 KB/s`: both rates in a fixed width. */
export function rateText(net: NonNullable<MachineSnap["net"]>, g: Pick<Glyphs, "down" | "up">): string {
  return decimalComma(`${g.down} ${fixedRate(net.rx)}  ${g.up} ${fixedRate(net.tx)}`);
}

/** `1,8  2,1  1,9` */
export const loadText = (load: readonly number[]): string =>
  load.map((value) => decimalComma(fixedNumber(value, { width: LOAD_W, decimals: 1 }))).join(" ");

/** `8 núcleos`, `1 núcleo`. */
export const coresText = (count: number): string => `${count} ${count === 1 ? "núcleo" : "núcleos"}`;

/** The hostname, then what the machine is, in two parts: the dim text up to the session and the session IP in its own color. */
export interface MachineHeadline {
  host: string;
  /** `Rocky Linux 8.10 · Issabel 5 · ligado há 3d 4h`, with ` · sessão ` after it when there is a session. */
  details: string;
  sessionIp?: string;
  /** The whole thing fits one row beside the hostname. */
  oneRow: boolean;
}

const HEADLINE_GAP_W = 3;

export function machineHeadline(machine: MachineSnap, product: string | undefined, sessionIp: string | undefined, width: number): MachineHeadline {
  const facts = [machine.os, product, `ligado há ${fmtUptime(machine.uptime)}`].filter(Boolean).join(" · ");
  const details = sessionIp ? `${facts} · sessão ` : facts;
  const detailsCells = [...details].length + [...(sessionIp ?? "")].length;
  const oneRow = [...machine.host].length + HEADLINE_GAP_W + detailsCells <= width;
  return { host: machine.host, details, sessionIp, oneRow };
}

/** How the cores of the cpu are laid out: `perRow` cells per row, each `idxWidth` of index, a space, `barWidth` of bar and a percentage. */
export interface CoreGrid {
  perRow: number;
  gap: number;
  idxWidth: number;
  barWidth: number;
}

const CORES_PER_ROW = 4;
const CORES_PER_ROW_WIDE = 8;
const GAP_W = 3;
const GAP_WIDE_W = 2;
const MANY_CORES = 8;
const MIN_BAR_W = 4;
/** Cells of a core's percentage (` 18%`). */
const CORE_PERCENT_W = 4;

/** Cells of one core: its index, a space, the bar and the percentage. */
const cellWidth = (idxWidth: number, barWidth: number): number => idxWidth + 1 + barWidth + CORE_PERCENT_W;

/** Whether eight cells with the smallest bar fit in `width`. */
const fitsWide = (width: number, idxWidth: number): boolean =>
  width >= CORES_PER_ROW_WIDE * cellWidth(idxWidth, MIN_BAR_W) + GAP_WIDE_W * (CORES_PER_ROW_WIDE - 1);

/** Four cores per row; eight when there are many and the terminal is wide enough, so 64 cores stay in eight rows. `width` is what is left after the indent. */
export function coreGrid(cores: number, width: number): CoreGrid {
  const idxWidth = String(Math.max(0, cores - 1)).length;
  const wide = cores > MANY_CORES && fitsWide(width, idxWidth);
  const perRow = wide ? CORES_PER_ROW_WIDE : CORES_PER_ROW;
  const gap = wide ? GAP_WIDE_W : GAP_W;
  const cell = Math.floor((width - gap * (perRow - 1)) / perRow);
  const barWidth = Math.max(MIN_BAR_W, cell - idxWidth - 1 - CORE_PERCENT_W);
  return { perRow, gap, idxWidth, barWidth };
}

/** The cores by index, `perRow` to a row. */
export function coreRows(cores: readonly number[], perRow: number): { index: number; value: number }[][] {
  const rows: { index: number; value: number }[][] = [];
  cores.forEach((value, index) => {
    if (index % perRow === 0) rows.push([]);
    rows[rows.length - 1]!.push({ index, value });
  });
  return rows;
}
