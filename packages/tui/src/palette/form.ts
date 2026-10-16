import type { ArgSpec } from "@pvx/sdk";

export type FormValues = Record<string, string | boolean | undefined>;

export interface BuiltLine {
  /** Words to execute (secrets never in it: the CLI refuses secrets on argv). */
  argv: string[];
  /** Same line as one string for preview and history. Secrets omitted. */
  display: string;
  /** Secret values by arg name. Pass them to `execute` via `secretEnv` (env) or `promptSecret`, never argv. */
  secrets: Record<string, string>;
  /** Required args still empty. */
  missing: string[];
}

const quote = (v: string) => (/^[^\s"'\\]+$/.test(v) ? v : `"${v.replace(/(["\\])/g, "\\$1")}"`);

/** Builds the equivalent CLI line from the form values. */
export function buildLine(key: string, specs: ArgSpec[] = [], values: FormValues = {}): BuiltLine {
  const argv = key.split(" ");
  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  const val = (s: ArgSpec) => values[s.name];
  for (const s of specs.filter((s) => s.kind === "positional" && !s.secret)) {
    const v = val(s);
    if (typeof v === "string" && v) argv.push(v);
  }
  for (const s of specs) {
    const v = val(s);
    const set = s.kind === "flag" ? v === true : typeof v === "string" && v !== "";
    if (s.secret) {
      if (set) secrets[s.name] = v as string;
    } else if (s.kind === "flag") {
      if (set) argv.push(`--${s.name}`);
    } else if (s.kind === "option" && set) argv.push(`--${s.name}`, v as string);
    if (s.required && !set) missing.push(s.name);
  }
  return { argv, display: argv.map(quote).join(" "), secrets, missing };
}

/** Env form of the secrets, as `parseArgs` reads them (`ParseOpts.env`). */
export const secretEnv = (secrets: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(secrets).map(([k, v]) => [`PVX_SECRET_${k.toUpperCase().replace(/-/g, "_")}`, v]));

/** Rows of the detail under the palette list that show arguments. */
export const ARG_ROWS = 3;
/** Rows of the detail: the arguments, the command line and the status row. Fixed, so the palette never changes size. */
export const DETAIL_ROWS = ARG_ROWS + 2;

/** `text` cut to `width` cells, the last one a `…` when it does not fit. */
export function cutText(text: string, width: number): string {
  const cells = [...text];
  if (cells.length <= width) return text;
  return [...cells.slice(0, Math.max(0, width - 1)), "…"].slice(0, width).join("");
}

/** The arguments in view: the first `rows`, or the window that ends at the focused one; `hidden` counts the others. */
export function argWindow(total: number, focus: number, rows: number): { start: number; hidden: number } {
  const start = Math.max(0, Math.min(focus - rows + 1, total - rows));
  return { start, hidden: Math.max(0, total - rows) };
}

/** The dim line under the command line: how many arguments are out of view, where the secrets went, the last run. */
export function statusText({ hidden, secrets, last }: { hidden: number; secrets: string[]; last?: string }): string {
  const parts = [
    hidden ? `+${hidden} args (tab)` : "",
    secrets.length ? `segredo fora da linha: ${secrets.join(", ")}` : "",
    last ? `última: ${last}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
