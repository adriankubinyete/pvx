/** Minimal truecolor ANSI helpers for CLI output. */
const RESET = "\x1b[0m";

let colorEnabled = true;

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function fg(color: string, s: string): string {
  if (!colorEnabled || s === "") return s;
  const [r, g, b] = hexToRgb(color);
  return `\x1b[38;2;${r};${g};${b}m${s}${RESET}`;
}

export function bold(s: string): string {
  return colorEnabled && s !== "" ? `\x1b[1m${s}${RESET}` : s;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
