import type { ArgSpec } from "@pvx/sdk";
import { CORE, resolveCommand, type Registry } from "@pvx/core";

export interface Candidate {
  /** Replacement for `input.slice(start)`. */
  text: string;
  /** What the popup shows (the match range indexes into it). */
  label: string;
  /** Matched span in `label`, for underlining. */
  range: [number, number];
  help?: string;
  usage?: string;
  destructive?: boolean;
}
export interface Completion {
  start: number;
  items: Candidate[];
}

const LIMIT = 6;

/** Prefix matches first, then "contains" matches. */
export function rank<T>(items: T[], label: (t: T) => string, q: string): { item: T; range: [number, number] }[] {
  const n = q.toLowerCase();
  const prefix: { item: T; range: [number, number] }[] = [];
  const inner: typeof prefix = [];
  for (const item of items) {
    const i = label(item).toLowerCase().indexOf(n);
    if (i === 0) prefix.push({ item, range: [0, q.length] });
    else if (i > 0) inner.push({ item, range: [i, i + q.length] });
  }
  return [...prefix, ...inner];
}

const usage = (args: ArgSpec[] = []) =>
  args
    .filter((a) => !a.secret)
    .map((a) => {
      const t = a.kind === "positional" ? `<${a.name}>` : a.kind === "flag" ? `--${a.name}` : `--${a.name} <v>`;
      return a.required ? t : `[${t}]`;
    })
    .join(" ");

interface Cmd {
  help?: string;
  args?: ArgSpec[];
  destructive?: boolean;
}
/** Core commands (`modules add`, `logs`...) plus the `h` alias, as the palette lists them. */
const CORE_CMDS: [string, Cmd][] = [...CORE.map((c): [string, Cmd] => [c.key, c]), ["h", { help: "Atalho de help" }]];

/** Completion of the line being typed: command paths (module and core), then flags and values from `ArgSpec`. Pure. */
export function complete(registry: Pick<Registry, "commands">, input: string): Completion {
  if (input.startsWith("!")) return { start: 0, items: [] }; // a host shell line (`!cmd`, `!!`): nothing to complete
  const words = input.split(/\s+/);
  const last = words.pop()!;
  const done = words.filter(Boolean);
  const start = input.length - last.length;
  const all: [string, Cmd][] = [...registry.commands.entries(), ...CORE_CMDS.filter(([k]) => !registry.commands.has(k))];
  const found = done.length
    ? resolveCommand(registry as Registry, done) ?? coreFound(done)
    : undefined;

  if (!found) {
    const q = input.trimStart().replace(/\s+/g, " ");
    if (!q) return { start: 0, items: [] };
    const items = rank(all, ([k]) => k, q).slice(0, LIMIT).map(({ item: [key, c], range }) => ({
      text: `${key} `, label: key, range, help: c.help, usage: usage(c.args), destructive: c.destructive,
    }));
    return { start: 0, items };
  }

  const specs = (found.cmd.args ?? []).filter((a) => !a.secret);
  const rest = done.slice(found.n);
  const used = new Set(rest.filter((w) => w.startsWith("--")).map((w) => w.slice(2).split("=")[0]));
  const prev = rest.at(-1);
  const opt = prev?.startsWith("--") ? specs.find((s) => s.kind === "option" && `--${s.name}` === prev) : undefined;
  // Positionals filled so far: words that are neither flags nor the value of an option.
  const filled = rest.filter((w, i) => !w.startsWith("--") && !(rest[i - 1]?.startsWith("--") && specs.some((s) => s.kind === "option" && `--${s.name}` === rest[i - 1]))).length;
  const spec = opt ?? specs.filter((s) => s.kind === "positional")[filled];

  const cands: { label: string; help?: string }[] = [];
  // Subcommands: `modules a` -> `add`.
  const head = `${done.join(" ")} `;
  for (const [k, c] of all) {
    const next = k.startsWith(head) ? k.slice(head.length).split(" ")[0] : undefined;
    if (next && !cands.some((x) => x.label === next)) cands.push({ label: next, help: c.help });
  }
  if (spec?.values) cands.push(...spec.values.map((v) => ({ label: v, help: spec.help })));
  if (!opt) {
    cands.push(...specs.filter((s) => s.kind !== "positional" && !used.has(s.name)).map((s) => ({ label: `--${s.name}`, help: s.help })));
  }
  const q = last;
  const ranked = q ? rank(cands, (c) => c.label, q) : cands.map((item) => ({ item, range: [0, 0] as [number, number] }));
  return { start, items: ranked.slice(0, LIMIT).map(({ item, range }) => ({ text: `${item.label} `, label: item.label, range, help: item.help })) };
}

/** The longest core key that prefixes `words` (`modules add x` -> `modules add`), shaped like `resolveCommand`'s hit. */
function coreFound(words: string[]): { cmd: Cmd; n: number } | undefined {
  const hit = CORE_CMDS.filter(([k]) => k.split(" ").every((w, i) => words[i] === w)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit && { cmd: hit[1], n: hit[0].split(" ").length };
}
