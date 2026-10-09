// Pure model of notes.jsonl: events in, folded notes out. No I/O here.

export const MAX_BYTES = 8192;
export type EventKind = "add" | "edit" | "pin" | "unpin" | "resolve";
const KINDS: readonly string[] = ["add", "edit", "pin", "unpin", "resolve"];

/** One line of notes.jsonl. The contract with the diary: DECISIONS.md, "Fase 6". */
export interface NoteEvent {
  v: 1;
  id: string;
  at: string;
  ev: EventKind;
  author: string;
  text?: string;
  tags?: string[];
  login?: boolean;
  ref?: string;
}

export interface Note {
  id: string;
  author: string;
  /** When the note was added. */
  at: string;
  /** Last event of any kind. */
  updatedAt: string;
  text: string;
  tags: string[];
  login: boolean;
  pinned: boolean;
  resolved: boolean;
  ref?: string;
}

/** Notes are untrusted: OpenTUI and the CLI print ANSI literally. Drops escape sequences and control characters; keeps `\n`. */
export function clean(s: string): string {
  return s
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b\[[0-?]*[ -/]*[@-~]?|\u001b[@-_]?/g, "")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}
export const oneLine = (s: string) => clean(s).replace(/\n+/g, " ").trim();
export const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Reads the file. A line that is not a valid event is skipped: a damaged line never hides the others. */
export function parseEvents(raw: string): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as NoteEvent;
      if (e && e.v === 1 && typeof e.id === "string" && typeof e.at === "string" && typeof e.author === "string" && KINDS.includes(e.ev)) out.push(e);
    } catch {}
  }
  return out;
}

/** The current state: events folded by id, in file order. A note without an `add` (a lost line) does not exist. */
export function fold(events: readonly NoteEvent[]): Note[] {
  const notes = new Map<string, Note>();
  for (const e of events) {
    const n = notes.get(e.id);
    if (e.ev === "add") {
      if (n) continue; // a repeated id never rewrites the first note
      notes.set(e.id, {
        id: e.id, author: clean(e.author), at: e.at, updatedAt: e.at, text: clean(e.text ?? ""),
        tags: (e.tags ?? []).map((t) => oneLine(String(t))).filter(Boolean), login: e.login === true, pinned: false, resolved: false,
        ...(e.ref ? { ref: oneLine(e.ref) } : {}),
      });
      continue;
    }
    if (!n) continue;
    n.updatedAt = e.at;
    if (e.ev === "edit") {
      if (e.text !== undefined) n.text = clean(e.text);
      if (e.tags) n.tags = e.tags.map((t) => oneLine(String(t))).filter(Boolean);
      if (e.login !== undefined) n.login = e.login;
    } else if (e.ev === "pin") n.pinned = true;
    else if (e.ev === "unpin") n.pinned = false;
    else n.resolved = true;
  }
  return [...notes.values()];
}

/** Ids of the notes with an event by ANOTHER author after `since` (ISO; none means everything). */
export function newIds(events: readonly NoteEvent[], user: string, since?: string): Set<string> {
  return new Set(events.filter((e) => e.author !== user && (!since || e.at > since)).map((e) => e.id));
}

/** Short stable id: 6 hex chars, not used yet. */
export function freshId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("");
    if (!taken.has(id)) return id;
  }
}

/** The note an id or a unique prefix points to, among `ids`. */
export function resolveId(ids: readonly string[], ref: string): { id: string } | { error: string } {
  const r = ref.trim().toLowerCase();
  const hit = ids.filter((i) => i === r);
  const m = hit.length ? hit : ids.filter((i) => r && i.startsWith(r));
  return m.length === 1 ? { id: m[0]! } : { error: m.length ? `id "${oneLine(ref)}" é ambíguo` : `nota não encontrada: ${oneLine(ref)}` };
}
