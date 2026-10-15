// Numbers that refresh live keep a fixed width, so nothing after them moves on every update (UI.md, "valor ao vivo tem largura fixa").

export interface FixedOptions {
  /** Cells of the number itself; the number is right-aligned in them. */
  width: number;
  /** Decimal places (default 0). */
  decimals?: number;
  /** Text after the number, kept as given (`" proc"`). */
  unit?: string;
}

/** `value` right-aligned in `width` cells, then the unit: `fixedNumber(96, { width: 5, unit: " proc" })` is `"   96 proc"`. */
export function fixedNumber(value: number, { width, decimals = 0, unit = "" }: FixedOptions): string {
  return `${value.toFixed(decimals).padStart(width)}${unit}`;
}

const KIB = 1024;
const MIB = KIB * 1024;
/** Cells of the number in a rate (`1023`, `99.9`, `340`), and of the unit (`KB/s`, `MB/s`; `B/s` is padded). */
const RATE_NUMBER_W = 5;
const RATE_UNIT_W = 4;

/** A byte rate in a fixed 10 cells: `"  212 B/s "`, `"  340 KB/s"`, `"  1.2 MB/s"`. */
export function fixedRate(bytesPerSecond: number): string {
  const unit = (text: string) => ` ${text.padEnd(RATE_UNIT_W)}`;
  if (bytesPerSecond < KIB) return fixedNumber(Math.round(bytesPerSecond), { width: RATE_NUMBER_W }) + unit("B/s");
  if (bytesPerSecond < MIB) return fixedNumber(Math.round(bytesPerSecond / KIB), { width: RATE_NUMBER_W }) + unit("KB/s");
  return fixedNumber(bytesPerSecond / MIB, { width: RATE_NUMBER_W, decimals: 1 }) + unit("MB/s");
}

/** A percentage (0..100) as `" 41%"`: three cells for the number, so `5%` and `100%` line up. */
export const fixedPercent = (percent: number): string => fixedNumber(Math.round(percent), { width: 3, unit: "%" });
