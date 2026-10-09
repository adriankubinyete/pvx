import { join } from "node:path";
import { pvxHome } from "../engine/paths.ts";
import { auditFile } from "./audit.ts";
import { conformityFile, type Drift } from "./drift.ts";
import { readJsonl } from "./jsonl.ts";

export const KINDS = ["nota", "cmd", "conf", "login", "module"] as const;
export type Kind = (typeof KINDS)[number];

export interface DiaryEntry {
  /** Unique in the diary: the page selects by it. */
  id: string;
  kind: Kind;
  /** ISO instant. */
  at: string;
  /** Absent on `conf` (the host saw it, nobody did it). */
  user?: string;
  /** Masked line, note text, change text, `SSH de ...`, or the module action. */
  text: string;
  /** What `nota add --ref` links to: `nota:<note id>`, `cap:<capability id>`, or `<kind>:<at>`. */
  ref: string;
  /** Kind-specific fields: cmd `exit ms destructive`, conf `cap from to`, login `from`, nota `ev tags`. */
  data: Record<string, unknown>;
}

export interface DiaryQuery {
  /** Instant (ms, Date or ISO) or a relative window: `24h`, `7d`, `30m`. */
  since?: number | Date | string;
  kinds?: readonly Kind[];
  /** Case-insensitive, over text and user. */
  text?: string;
  user?: string;
  /** Per source, and for the result (newest kept). Default 500. */
  limit?: number;
}

interface NoteEvent { v: 1; id: string; at: string; ev: "add" | "edit" | "pin" | "unpin" | "resolve"; author: string; text?: string; tags?: string[]; login?: boolean; ref?: string }
interface AuditEvent { v: 1; at: string; kind?: "cmd" | "login" | "module"; user?: string; line?: string; exit?: number; ms?: number; destructive?: boolean; from?: string; text?: string }

const VERB: Record<NoteEvent["ev"], string> = { add: "nota", edit: "editou a nota", pin: "fixou a nota", unpin: "desafixou a nota", resolve: "resolveu a nota" };

/** `24h`, `7d`, `30m` back from `now`, or an ISO instant. */
export function parseSince(s: string | number | Date, now = Date.now()): number {
  if (typeof s === "number") return s;
  if (s instanceof Date) return s.getTime();
  const rel = /^(\d+)([mhd])$/.exec(s.trim());
  if (rel) return now - Number(rel[1]) * { m: 60000, h: 3600000, d: 86400000 }[rel[2] as "m" | "h" | "d"];
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`instante inválido: \`${s}\` (use 24h, 7d ou uma data ISO)`);
  return t;
}

const noteEntry = (e: NoteEvent): DiaryEntry => ({
  id: `nota|${e.at}|${e.id}|${e.ev}`, kind: "nota", at: e.at, user: e.author, text: e.text?.trim() || VERB[e.ev], ref: `nota:${e.id}`,
  data: { note: e.id, ev: e.ev, ...(e.tags ? { tags: e.tags } : {}), ...(e.ref ? { to: e.ref } : {}) },
});
const confEntry = (e: Drift): DiaryEntry => ({ id: `conf|${e.at}|${e.id}`, kind: "conf", at: e.at, text: e.text, ref: `cap:${e.id}`, data: { cap: e.id, from: e.from, to: e.to } });
const auditEntry = (e: AuditEvent): DiaryEntry => {
  const kind = e.kind ?? "cmd";
  const base = { id: `${kind}|${e.at}`, kind, at: e.at, user: e.user, ref: `${kind}:${e.at}` };
  if (kind === "login") return { ...base, text: e.from ? `SSH de ${e.from}` : "login", data: { from: e.from } };
  if (kind === "module") return { ...base, text: e.text ?? "", data: {} };
  return { ...base, text: e.line ?? "", data: { exit: e.exit, ms: e.ms, destructive: e.destructive } };
};

/**
 * The five sources merged, newest first: `nota` (notes.jsonl), `cmd`, `login` and `module` (audit.jsonl), `conf` (conformity.jsonl).
 * Each source is read from its end and stops at `since` (or `limit`), so a refresh never re-reads a big file.
 */
function query(q: DiaryQuery = {}, now = Date.now()): DiaryEntry[] {
  const kinds = new Set<Kind>(q.kinds?.length ? q.kinds : KINDS);
  const read = { sinceMs: q.since === undefined ? undefined : parseSince(q.since, now), limit: q.limit ?? 500 };
  const out: DiaryEntry[] = [];
  if (kinds.has("nota")) out.push(...readJsonl<NoteEvent>(join(pvxHome(), "notes.jsonl"), read).map(noteEntry));
  if (kinds.has("conf")) out.push(...readJsonl<Drift>(conformityFile(), read).map(confEntry));
  if (["cmd", "login", "module"].some((k) => kinds.has(k as Kind))) out.push(...readJsonl<AuditEvent>(auditFile(), read).map(auditEntry).filter((e) => kinds.has(e.kind)));
  const needle = q.text?.toLowerCase();
  return out
    .filter((e) => (!q.user || e.user === q.user) && (!needle || `${e.text} ${e.user ?? ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, read.limit);
}

export const diary = { query };

/** "Novidades": entries after the user's last visit that somebody else made. */
export const novidades = (entries: readonly DiaryEntry[], seenMs: number | undefined, me: string) =>
  seenMs === undefined ? [] : entries.filter((e) => Date.parse(e.at) > seenMs && e.user !== me);
