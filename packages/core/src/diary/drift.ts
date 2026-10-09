import { join } from "node:path";
import { pvxHome } from "../engine/paths.ts";
import { readJson, writeJsonAtomic } from "../modules/trust.ts";
import { appendJsonl, readJsonl } from "./jsonl.ts";

type Level = "ok" | "warn" | "error";
export interface Drift {
  v: 1;
  at: string;
  id: string;
  from: Level;
  to: Level;
  text: string;
}

const RANK: Record<Level, number> = { ok: 0, warn: 1, error: 2 };
export const conformityFile = () => join(pvxHome(), "conformity.jsonl");
const lastFile = () => join(pvxHome(), "conformity-last.json");

/**
 * Appends only the level changes since the last evaluation. The last-known levels live in `conformity-last.json`;
 * a capability seen for the first time only sets the baseline (no event). Best effort: never fails the evaluation.
 */
export function recordDrift(results: { id: string; level: Level; text: string }[], now = Date.now()): void {
  try {
    const last = readJson<Record<string, Level>>(lastFile(), {});
    let changed = false;
    for (const r of results) {
      const from = last[r.id];
      if (from !== r.level) {
        if (from) appendJsonl(conformityFile(), { v: 1, at: new Date(now).toISOString(), id: r.id, from, to: r.level, text: r.text } satisfies Drift);
        last[r.id] = r.level;
        changed = true;
      }
    }
    if (changed) writeJsonAtomic(lastFile(), last);
  } catch {}
}

/** The last evaluation as the login banner reads it: it never evaluates, it shows this and its age. */
export interface Snapshot {
  at: number;
  profile: string;
  results: { id: string; level: Level; text: string; fix?: string }[];
}
const snapshotFile = () => join(pvxHome(), "conformity-snapshot.json");
/** Best effort, like `recordDrift`. */
export function recordSnapshot(profile: string, results: { id: string; title: string; level: Level; text: string; fix?: string }[], now = Date.now()): void {
  try {
    writeJsonAtomic(snapshotFile(), { at: now, profile, results: results.map((r) => ({ id: r.id, level: r.level, text: `${r.title}: ${r.text}`, ...(r.fix ? { fix: r.fix } : {}) })) } satisfies Snapshot);
  } catch {}
}
export const readSnapshot = (): Snapshot | undefined => {
  const s = readJson<Partial<Snapshot>>(snapshotFile(), {});
  return typeof s.at === "number" && Array.isArray(s.results) ? (s as Snapshot) : undefined;
};

/** The latest level change of a capability, for the evidence ("piorou hoje 09:02"). */
export function driftOf(id: string, now = Date.now()): (Drift & { worse: boolean; label: string }) | undefined {
  const d = readJsonl<Drift>(conformityFile(), { limit: 1000 }).find((e) => e.id === id);
  return d && { ...d, worse: RANK[d.to] > RANK[d.from], label: driftLabel(d, now) };
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const day = (t: number) => new Date(t).toDateString();

/** `piorou hoje 09:02`, `melhorou ontem 18:00`, `piorou 06/10 16:10`. */
export function driftLabel(d: Pick<Drift, "at" | "from" | "to">, now = Date.now()): string {
  const t = Date.parse(d.at);
  const when = day(t) === day(now) ? "hoje" : day(t) === day(now - 86400000) ? "ontem" : new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${RANK[d.to] > RANK[d.from] ? "piorou" : "melhorou"} ${when} ${hhmm(t)}`;
}
