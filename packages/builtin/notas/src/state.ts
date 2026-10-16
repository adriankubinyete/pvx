// What the module writes: one append-only file of events. Written by `nota add` and `nota remove`, read by the commands, the widget and the query.

/** Where the notes live. `PVX_HOME/notes.jsonl` is the file `pvx uninstall` keeps. */
export const NOTES_FILE = "$PVX_HOME/notes.jsonl";

/** Version of the events written today. Version 1 (older pvx) also had `edit`, `pin`, `unpin` and `resolve`. */
export const EVENT_VERSION = 2;

/** `edit`, `pin`, `unpin` and `resolve` are only read: older files still have them. */
export type EventKind = "add" | "remove" | "edit" | "pin" | "unpin" | "resolve";

/** One line of notes.jsonl. The current state is the fold of the events by id. */
export interface NoteEvent {
  v: number;
  id: string;
  at: string;
  ev: EventKind;
  /** The system user that ran the command. In a version 1 `add` it is also the signature. */
  author: string;
  text?: string;
  /** Who wrote the note, when they said (version 2). */
  signature?: string;
}

/** An open note. `n` is its place in the order the notes were added; removed notes keep their number, so it never changes. */
export interface Note {
  n: number;
  id: string;
  at: string;
  text: string;
  signature?: string;
}
