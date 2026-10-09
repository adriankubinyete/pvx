import { join } from "node:path";
import { pvxHome } from "../engine/paths.ts";
import { readJson, writeJsonAtomic } from "../modules/trust.ts";
import { currentUser } from "./jsonl.ts";

export const IGNORE_MS = 24 * 3600 * 1000;
export interface Ignore {
  id: string;
  /** ISO instant the ignore ends. */
  until: string;
  reason: string;
  author: string;
}

const file = () => join(pvxHome(), "ignores.json");
const all = () => readJson<Ignore[]>(file(), []);

/** The ignores still in force; the clock is injected so expiry is testable. */
export const activeIgnores = (now = Date.now()): Ignore[] => all().filter((i) => Date.parse(i.until) > now);

/** Ignores a capability for 24 h (a second ignore replaces the first). Drops the expired ones on the way. */
export function addIgnore(id: string, reason: string, now = Date.now(), author = currentUser()): Ignore {
  const ig: Ignore = { id, until: new Date(now + IGNORE_MS).toISOString(), reason, author };
  writeJsonAtomic(file(), [...activeIgnores(now).filter((i) => i.id !== id), ig]);
  return ig;
}

/** Splits pending results into live and ignored: an ignored item is out of the plan; one that is already ok is never "ignored". */
export function partitionIgnored<T extends { id: string; level: string }>(results: T[], now = Date.now()): { live: T[]; ignored: (T & { until: string })[] } {
  const by = new Map(activeIgnores(now).map((i) => [i.id, i.until]));
  const live: T[] = [];
  const ignored: (T & { until: string })[] = [];
  for (const r of results) {
    const until = r.level === "ok" ? undefined : by.get(r.id);
    if (until) ignored.push({ ...r, until });
    else live.push(r);
  }
  return { live, ignored };
}
