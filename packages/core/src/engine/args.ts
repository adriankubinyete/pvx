import type { ArgSpec } from "@pvx/sdk";

export type ArgValues = Record<string, string | boolean | undefined>;
export type ParseResult =
  | { ok: true; args: ArgValues; masked: ArgValues }
  | { ok: false; message: string; /** set when a required secret has no source: the CLI may prompt on a TTY */ missingSecret?: string };

export interface ParseOpts {
  env?: Record<string, string | undefined>;
  /** Without it a `stdin` positional is never read (a TTY has nothing to pipe). Secrets fall back to the real stdin. */
  readStdin?: () => Promise<string>;
  /** CLI hook (TTY only). Returning undefined means "no secret". */
  promptSecret?: (name: string) => Promise<string | undefined>;
}

const envName = (n: string) => `PVX_SECRET_${n.toUpperCase().replace(/-/g, "_")}`;
const fail = (message: string, missingSecret?: string): ParseResult => ({ ok: false, message, missingSecret });

/** Parses argv (already without the command path) against specs. Secrets never come from argv. */
export async function parseArgs(specs: ArgSpec[] = [], argv: string[], opts: ParseOpts = {}): Promise<ParseResult> {
  const env = opts.env ?? process.env;
  const args: ArgValues = {};
  const stdinFor = new Set<string>();
  const positionals = specs.filter((s) => s.kind === "positional" && !s.secret);
  let pi = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--") || a === "--") {
      const spec = positionals[pi++];
      const rest = positionals.at(-1);
      // The free-text positional (`stdin`) takes the remaining words, so `<cmd> texto sem aspas` works.
      if (!spec && rest?.stdin && typeof args[rest.name] === "string") {
        args[rest.name] += ` ${a}`;
        continue;
      }
      // A secret typed as a positional lands here: never echo the value back.
      if (!spec) return fail(`argumento inesperado${specs.some((s) => s.secret) ? "" : `: \`${a}\``}`);
      args[spec.name] = a;
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    const spec = specs.find((s) => s.name === name && s.kind !== "positional");
    if (!spec) {
      const sname = name.endsWith("-stdin") ? name.slice(0, -6) : "";
      if (specs.some((s) => s.secret && s.name === sname)) {
        stdinFor.add(sname);
        continue;
      }
      return fail(`opção desconhecida: \`--${name}\``);
    }
    if (spec.secret) {
      return fail(`segredo \`--${name}\` não vai por argumento; use \`--${name}-stdin\` ou ${envName(name)}`);
    }
    if (spec.kind === "flag") args[name] = true;
    else {
      let v: string;
      if (eq >= 0) v = a.slice(eq + 1);
      else if (i + 1 < argv.length) v = argv[++i]!;
      else return fail(`falta o valor de \`--${name}\``);
      const prev = args[name];
      args[name] = spec.repeat && typeof prev === "string" ? `${prev},${v}` : v;
    }
  }
  const secrets = new Set<string>();
  for (const s of specs) {
    if (s.stdin && s.kind === "positional" && !args[s.name] && opts.readStdin) {
      const v = (await opts.readStdin()).replace(/\r?\n$/, "");
      if (v) args[s.name] = v;
    }
    if (s.secret) {
      secrets.add(s.name);
      let v: string | undefined;
      if (stdinFor.has(s.name)) v = (await (opts.readStdin ?? (() => Bun.stdin.text()))()).replace(/\r?\n$/, "");
      else v = env[envName(s.name)] ?? (await opts.promptSecret?.(s.name));
      if (v) args[s.name] = v;
    }
    if (s.required && (args[s.name] === undefined || (s.stdin && args[s.name] === ""))) {
      const shown = s.kind === "positional" ? `<${s.name}>` : `--${s.name}`;
      return fail(`falta o argumento \`${shown}\``, s.secret ? s.name : undefined);
    }
  }
  const masked = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, secrets.has(k) ? "***" : v]));
  return { ok: true, args, masked };
}
