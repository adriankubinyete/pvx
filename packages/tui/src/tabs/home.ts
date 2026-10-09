import type { SlotHub } from "@pvx/core";
import type { SlotId } from "@pvx/sdk";
import type { Glyphs } from "../theme.ts";
import type { Block } from "../session/store.ts";
import type { CoreResult } from "./CoreTab.tsx";

export type Level = "ok" | "warn" | "error";

/** Meter color: above 85% error, above 70% warn. */
export const levelOf = (pct: number): Level => (pct > 85 ? "error" : pct > 70 ? "warn" : "ok");

/** `▰▰▰▱▱▱▱▱▱▱` as two halves, so the caller can color the filled part. */
export function meter(pct: number, width: number, g: Glyphs): [filled: string, empty: string] {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return [g.meterFull.repeat(n), g.meterEmpty.repeat(width - n)];
}

export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : h ? `${h}h ${Math.floor((s % 3600) / 60)}min` : `${Math.floor(s / 60)}min`;
}

export function relTime(at: number, now: number): string {
  const m = Math.floor((now - at) / 60000);
  return m < 1 ? "agora" : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)} h` : `há ${Math.floor(m / 1440)} d`;
}

export interface Pending {
  /** The line's text: stable between runs, so selection survives a refresh. */
  id: string;
  level: "warn" | "error";
  text: string;
  fix?: string;
}
export interface Conformity {
  /** Without a profile: the message of the command, shown as is. */
  message?: string;
  ok: number;
  total: number;
  pending: Pending[];
  /** Titles of the items that are ok. */
  okItems: string[];
  /** Pending items someone ignored for 24 h (text already says "ignorado até HH:MM"). */
  ignored: string[];
}

/** Reads the `conformidade` output: `perfil: X`, one line per capability, then the summary. No `perfil:` line means no result to show. */
export function parseConformity(r: CoreResult): Conformity {
  if (!r.lines.some((l) => l.kind === "info" && l.text.startsWith("perfil: ")))
    return { message: r.lines[0]?.text ?? "sem resultado", ok: 0, total: 0, pending: [], okItems: [], ignored: [] };
  const items = r.lines.filter((l) => l.kind === "success" || l.kind === "warning" || l.kind === "error");
  const pending = items.filter((l) => l.kind !== "success").map((l): Pending => ({ id: l.text, level: l.kind === "error" ? "error" : "warn", text: l.text, fix: l.fix }));
  const ignored = r.lines.filter((l) => l.ignored).map((l) => l.text);
  return { ok: items.length - pending.length, total: items.length + ignored.length, pending, okItems: items.filter((l) => l.kind === "success").map((l) => l.text), ignored };
}

export interface Activity {
  id: string;
  line: string;
  favorite: boolean;
  status?: Block["status"];
  at?: number;
}

/** Favorites first, then the latest distinct history lines; status and time come from this session's blocks, when there is one. */
export function activity(history: readonly string[], blocks: readonly Block[], favorites: readonly string[], max = 5): Activity[] {
  const lastBlock = (line: string) => blocks.findLast((b) => b.line === line);
  const mk = (line: string, favorite: boolean): Activity => {
    const b = lastBlock(line);
    return { id: `${favorite ? "f" : "h"}:${line}`, line, favorite, status: b?.status, at: b?.at };
  };
  const recents = [...new Set([...history].reverse())].filter((l) => !favorites.includes(l)).slice(0, max);
  return [...favorites.slice(0, max).map((l) => mk(l, true)), ...recents.map((l) => mk(l, false))];
}

type Att = { level: Level; title: string; fix?: string };
type Chip = { label: string; level: Level; detail?: string };

/** What the host puts in the slots from the cached `conformidade` result (the profile's capabilities). */
export function syncHost(hub: SlotHub, done?: Conformity) {
  const has = done && !done.message;
  hub.setHost("home.attention", has ? done.pending.map((p): Att => ({ level: p.level, title: p.text, fix: p.fix })) : undefined);
  hub.setHost("home.configured", has ? done.okItems.map((title): Att => ({ level: "ok", title })) : undefined);
  hub.setHost("home.summary", has ? `${done.ok} de ${done.total}` : undefined);
}

export const slotItems = <T,>(hub: SlotHub, slot: SlotId): T[] => (hub.read(slot) as T[] | undefined) ?? [];
export type { Att, Chip };
