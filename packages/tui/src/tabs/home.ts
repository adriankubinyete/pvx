import type { SlotHub } from "@pvx/core";
import type { SlotId } from "@pvx/sdk";
import type { Glyphs } from "../theme.ts";
import type { Block } from "../session/store.ts";

export type Level = "ok" | "warn" | "error";

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

/** What the host puts in the slots: the load avisos. */
export function syncHost(hub: SlotHub, warnings: readonly string[] = []) {
  hub.setHost("home.chips", warnings.length ? warnings.map(warningChip) : undefined);
}

/** A host aviso (an installed module that lost to an embedded one) as a warning chip of the Início. */
const warningChip = (label: string): Chip => ({ label, level: "warn" });

/** `hidden`: modules whose widgets the user turned off. */
export const slotItems = <T,>(hub: SlotHub, slot: SlotId, hidden?: ReadonlySet<string>): T[] => (hub.read(slot, hidden) as T[] | undefined) ?? [];
export type { Att, Chip };
