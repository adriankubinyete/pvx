import type { Registry } from "@pvx/core";
import { sanitize } from "../session/store.ts";

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
  /** Matched range in `key` (start inclusive, end exclusive); null when nothing to highlight. */
  range: [number, number] | null;
}

/** One-line form of `sanitize`: module-provided text must not carry ANSI or control characters into `<text>`. */
export const clean = (s: string) => sanitize(s).join(" ");

/** Fase 4: the manifest gets a real `origin` (trust store / dev link); until then everything is a usermodule. */
const originOf = (m: object | undefined): Origin => {
  const o = (m as { origin?: string } | undefined)?.origin;
  return o === "official" || o === "dev" ? o : "usermodule";
};

/** Rank: 0 prefix of the key, 1 prefix of a word, 2 contains; -1 no match. Empty term matches all (rank 0). */
function rank(key: string, term: string): { r: number; range: [number, number] | null } {
  if (!term) return { r: 0, range: null };
  const k = key.toLowerCase();
  const t = term.toLowerCase();
  if (k.startsWith(t)) return { r: 0, range: [0, t.length] };
  const w = k.search(new RegExp(`[ -]${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (w >= 0) return { r: 1, range: [w + 1, w + 1 + t.length] };
  const i = k.indexOf(t);
  return i >= 0 ? { r: 2, range: [i, i + t.length] } : { r: -1, range: null };
}

/**
 * Scopes by prefix: `@mod` module, `>cmd` commands, `#page` pages, `!` destructive only.
 * Result is sorted by rank, then grouped by module in first-appearance order.
 */
export function search(registry: Registry, query: string): Hit[] {
  const q = query.trim();
  const scope = "@>#!".includes(q[0] ?? " ") ? q[0] : "";
  const term = scope ? q.slice(1).trim() : q;
  const hits: (Hit & { r: number })[] = [];
  if (scope === "#") {
    for (const p of registry.pages.values()) {
      const m = rank(p.key, term);
      if (m.r >= 0) hits.push({ key: p.key, moduleId: p.moduleId, origin: originOf(registry.modules.get(p.moduleId)), help: clean(p.title), destructive: false, page: true, range: m.range, r: m.r });
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
  hits.sort((a, b) => a.r - b.r || a.key.localeCompare(b.key));
  const order = [...new Set(hits.map((h) => h.moduleId))];
  return hits.sort((a, b) => order.indexOf(a.moduleId) - order.indexOf(b.moduleId)); // stable: keeps rank inside a module
}
