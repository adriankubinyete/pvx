// Pure model of notes.jsonl: events in, open notes out. No I/O here.
import { EVENT_VERSION, type EventKind, type Note, type NoteEvent } from "./state.ts";

export const MAX_BYTES = 8192;
export const MAX_SIGNATURE = 60;
const KINDS: readonly string[] = ["add", "remove", "edit", "pin", "unpin", "resolve"];
/** The events that take a note out of the lists: `resolve` is what older pvx wrote for it. */
const REMOVING: readonly EventKind[] = ["remove", "resolve"];

/** Notes are untrusted: OpenTUI and the CLI print ANSI literally. Drops escape sequences and control characters; keeps `\n`. */
export function clean(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b\[[0-?]*[ -/]*[@-~]?|\u001b[@-_]?/g, "")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}
export const oneLine = (text: string): string => clean(text).replace(/\n+/g, " ").trim();
export const bytes = (text: string): number => new TextEncoder().encode(text).length;

function isEvent(value: unknown): value is NoteEvent {
  const event = value as NoteEvent | null;
  if (!event || typeof event !== "object") return false;
  return typeof event.id === "string" && typeof event.at === "string" && typeof event.author === "string" && KINDS.includes(event.ev);
}

/** Reads the file. A line that is not a valid event is skipped: a damaged line never hides the others. */
export function parseEvents(raw: string): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isEvent(event)) events.push(event);
    } catch {}
  }
  return events;
}

/** Who signed an `add`: the signature of a version 2 event, the author of a version 1 one (the only name it had). */
function signatureOf(event: NoteEvent): string | undefined {
  const name = event.v >= EVENT_VERSION ? event.signature : event.author;
  return name ? oneLine(name) || undefined : undefined;
}

function noteOf(event: NoteEvent, n: number): Note {
  return { n, id: event.id, at: event.at, text: clean(event.text ?? ""), signature: signatureOf(event) };
}

/** The open notes in the order they were added. A repeated id never rewrites the first note; an event for a note that was never added does nothing. */
export function openNotes(events: readonly NoteEvent[]): Note[] {
  const notes = new Map<string, Note>();
  const removed = new Set<string>();
  let count = 0;
  for (const event of events) {
    if (event.ev === "add") {
      if (!notes.has(event.id)) notes.set(event.id, noteOf(event, ++count));
    } else if (REMOVING.includes(event.ev)) removed.add(event.id);
    else if (event.ev === "edit" && event.text !== undefined && notes.has(event.id)) notes.get(event.id)!.text = clean(event.text);
  }
  return [...notes.values()].filter((note) => !removed.has(note.id));
}

/** Newest first. */
export const newestFirst = (notes: readonly Note[]): Note[] => [...notes].sort((a, b) => b.n - a.n);

/** `16/10`, local time. */
export function dateText(at: string): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** `texto  — assinatura`, or just the text when nobody signed. */
export function bodyText(note: Note): string {
  const text = oneLine(note.text);
  return note.signature ? `${text}  — ${note.signature}` : text;
}

/** Short stable id: 6 hex chars, not used yet. */
export function freshId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!taken.has(id)) return id;
  }
}

/** The note number a user typed: a whole number from 1, or undefined. */
export function parseNumber(raw: string): number | undefined {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value >= 1 ? value : undefined;
}
