import { CORE, type Registry } from "@pvx/core";
import type { ArgSpec } from "@pvx/sdk";
import { sanitize } from "../session/store.ts";

/** Group of the core commands. */
export const CORE_ID = "núcleo";

export type Origin = "official" | "usermodule" | "dev";

export interface Hit {
  /** Command key: "<module> <path...>". */
  key: string;
  moduleId: string;
  origin: Origin;
  help: string;
  destructive: boolean;
  /** A page (the `#` scope): enter opens it. */
  page?: boolean;
  /** A core command (group "núcleo"); its `args` come from the CORE list, not from the registry. */
  core?: boolean;
  args?: ArgSpec[];
  /** Page row text: the title, or the key part after the module id. */
  label?: string;
  /** The page is also a tab in the tab bar. */
  tab?: boolean;
  /** Matched range in `key` (in `label` for pages; start inclusive, end exclusive); null when nothing to highlight. */
  range: [number, number] | null;
}

/** One-line form of `sanitize`: module-provided text must not carry ANSI or control characters into `<text>`. */
export const clean = (s: string) => sanitize(s).join(" ");

/** Origin comes from the manifest; anything without one is shown as a usermodule. */
const originOf = (m: object | undefined): Origin => {
  const o = (m as { origin?: string } | undefined)?.origin;
  return o === "official" || o === "dev" ? o : "usermodule";
};

/** Lowercase without accents, same length: `@nucleo` finds "núcleo". */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Rank: 0 prefix of the key, 1 prefix of a word, 2 contains; -1 no match. Empty term matches all (rank 0). */
function rank(key: string, term: string): { r: number; range: [number, number] | null } {
  if (!term) return { r: 0, range: null };
  const k = fold(key);
  const t = fold(term);
  if (k.startsWith(t)) return { r: 0, range: [0, t.length] };
  const w = k.search(new RegExp(`[ -]${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (w >= 0) return { r: 1, range: [w + 1, w + 1 + t.length] };
  const i = k.indexOf(t);
  return i >= 0 ? { r: 2, range: [i, i + t.length] } : { r: -1, range: null };
}

/**
 * Without scope: core commands, module commands and pages. Scopes by prefix: `@mod` module (`@núcleo` the core), `>cmd` commands (core and module), `#page` pages, `!` destructive only.
 * Result is sorted by rank, then grouped by module in first-appearance order.
 */
export function search(registry: Registry, query: string): Hit[] {
  const q = query.trim();
  const scope = "@>#!".includes(q[0] ?? " ") ? q[0] : "";
  const term = scope ? q.slice(1).trim() : q;
  const hits: (Hit & { r: number })[] = [];
  if (scope !== ">" && scope !== "!") {
    for (const p of registry.pages.values()) {
      const title = clean(p.title);
      const label = title || p.key.slice(p.moduleId.length + 1) || p.key;
      const byLabel = scope === "@" ? null : rank(label, term);
      const m = scope === "@" ? rank(p.moduleId, term) : rank(p.key, term);
      const r = byLabel && byLabel.r >= 0 && (m.r < 0 || byLabel.r <= m.r) ? byLabel.r : m.r; // best of title and key
      if (r < 0) continue;
      hits.push({ key: p.key, moduleId: p.moduleId, origin: originOf(registry.modules.get(p.moduleId)), help: title, label, tab: !!p.tab, destructive: false, page: true, range: byLabel && byLabel.r >= 0 ? byLabel.range : null, r });
    }
  }
  if (scope !== "#" && scope !== "!") {
    for (const c of CORE) {
      const m = scope === "@" ? rank(CORE_ID, term) : rank(c.key, term);
      if (m.r >= 0) hits.push({ key: c.key, moduleId: CORE_ID, origin: "official", help: clean(c.help), destructive: !!c.destructive, core: true, args: c.args, range: scope === "@" ? null : m.range, r: m.r });
    }
  }
  for (const [key, cmd] of scope === "#" ? [] : registry.commands) {
    if (scope === "!" && !cmd.destructive) continue;
    const m = scope === "@" ? rank(cmd.moduleId, term) : rank(key, term);
    if (m.r < 0) continue;
    hits.push({
      key, moduleId: cmd.moduleId, origin: originOf(registry.modules.get(cmd.moduleId)), help: clean(cmd.help),
      destructive: !!cmd.destructive, range: scope === "@" ? null : m.range, r: m.r,
    });
  }
  hits.sort((a, b) => a.r - b.r || +!!b.core - +!!a.core || a.key.localeCompare(b.key));
  const order = [...new Set(hits.map((h) => h.moduleId))];
  return hits.sort((a, b) => order.indexOf(a.moduleId) - order.indexOf(b.moduleId)); // stable: keeps rank inside a module
}
