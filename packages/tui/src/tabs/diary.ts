import { driftLabel, type DiaryEntry, type Kind } from "@pvx/core";

export const FILTERS = [
  { id: "tudo", kinds: undefined },
  { id: "novidades", kinds: undefined },
  { id: "notas", kinds: ["nota"] },
  { id: "comandos", kinds: ["cmd"] },
  { id: "conformidade", kinds: ["conf"] },
  { id: "logins", kinds: ["login"] },
] as const satisfies readonly { id: string; kinds: readonly Kind[] | undefined }[];
export type FilterId = (typeof FILTERS)[number]["id"];

/** What a chip shows. `module` entries have no chip of their own: they live under tudo and novidades. */
export function filterEntries(entries: readonly DiaryEntry[], filter: FilterId, news: ReadonlySet<string>): DiaryEntry[] {
  const f = FILTERS.find((x) => x.id === filter)!;
  if (filter === "novidades") return entries.filter((e) => news.has(e.id));
  return f.kinds ? entries.filter((e) => (f.kinds as readonly Kind[]).includes(e.kind)) : [...entries];
}

export const hhmm = (at: string) => new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayKey = (t: number) => new Date(t).toDateString();

/** `hoje`, `ontem`, else `06/10`. */
export function dayLabel(at: string, now: number): string {
  const t = Date.parse(at);
  return dayKey(t) === dayKey(now) ? "hoje" : dayKey(t) === dayKey(now - 86400000) ? "ontem" : new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export type DiaryRow = { type: "day"; id: string; label: string } | { type: "entry"; id: string; e: DiaryEntry };

/** Newest-first entries with a header row at every change of day. Row ids are entry ids, so selection never depends on the index. */
export function dayRows(entries: readonly DiaryEntry[], now: number): DiaryRow[] {
  const rows: DiaryRow[] = [];
  let last = "";
  for (const e of entries) {
    const label = dayLabel(e.at, now);
    const key = dayKey(Date.parse(e.at));
    if (key !== last) rows.push({ type: "day", id: `day|${key}`, label }), (last = key);
    rows.push({ type: "entry", id: e.id, e });
  }
  return rows;
}

export interface DetailLine {
  label?: string;
  text: string;
  tone?: "dim" | "ok" | "warn" | "error" | "info";
}

/** The detail panel of an entry, per type. `text` is untrusted: the caller cleans it. */
export function detailLines(e: DiaryEntry, now: number): DetailLine[] {
  const when: DetailLine = { text: `${dayLabel(e.at, now)} ${hhmm(e.at)}${e.user ? ` · ${e.user}` : ""}`, tone: "dim" };
  const d = e.data as Record<string, any>;
  switch (e.kind) {
    case "nota":
      return [when, { text: e.text }, ...(d.tags?.length ? [{ label: "tags", text: d.tags.join(", ") }] : []), ...(d.to ? [{ label: "ligada a", text: String(d.to) }] : []), { label: "evento", text: String(d.ev) }];
    case "cmd":
      return [
        when,
        { text: e.text },
        { label: "resultado", text: d.exit === 0 ? "ok" : `exit ${d.exit}`, tone: d.exit === 0 ? "ok" : "error" },
        { label: "duração", text: `${d.ms} ms` },
        ...(d.destructive ? [{ label: "destrutivo", text: "sim", tone: "warn" as const }] : []),
      ];
    case "conf":
      return [
        when,
        { text: e.text },
        { label: "nível", text: `${d.from} -> ${d.to}`, tone: d.to === "ok" ? "ok" : d.to === "warn" ? "warn" : "error" },
        { label: "deriva", text: driftLabel({ at: e.at, from: d.from, to: d.to }, now) },
        { label: "capacidade", text: String(d.cap) },
      ];
    case "login":
      return [when, { label: "origem", text: d.from ? String(d.from) : "desconhecida" }];
    default:
      return [when, { text: e.text }];
  }
}
