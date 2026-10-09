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
