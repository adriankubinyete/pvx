/** Pure single-line editor model. Cursor counts code points, so it never splits a glyph. */
export interface Line {
  text: string;
  cursor: number;
}
export interface Edit extends Line {
  /** The cursor tried to cross a boundary: `left` at 0, `right` at the end. The text is unchanged. */
  exit?: "left" | "right";
}
/** The slice of `KeyEvent` the editor reads. */
export interface EditKey {
  name: string;
  sequence: string;
  ctrl?: boolean;
  meta?: boolean;
  /** Set by the `KeyRouter` for a bracketed paste: the raw pasted text, not a key. */
  paste?: string;
}

/** Terminal escape sequences: CSI (colors, cursor), OSC (up to BEL or ST), and a lone ESC plus one character. */
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b./gs;
/** Newlines and carriage returns: a one-line field drops them, so a pasted password with a trailing newline stays whole. */
const LINE_BREAKS = /[\r\n]/g;
/** Every other control character (tab included) and DEL. */
const CONTROLS = /[\x00-\x1f\x7f]/g;

/** What a one-line field keeps from a paste: no escapes, no line breaks (joined, not refused), no control characters. */
export function pastedText(raw: string): string {
  return raw.replace(ESCAPES, "").replace(LINE_BREAKS, "").replace(CONTROLS, "");
}

/** Inserts the paste at the cursor. A paste with nothing left after cleaning changes nothing. */
function insertPaste({ text, cursor }: Line, raw: string): Edit {
  const pasted = [...pastedText(raw)];
  const cs = [...text];
  return { text: [...cs.slice(0, cursor), ...pasted, ...cs.slice(cursor)].join(""), cursor: cursor + pasted.length };
}

export const lineOf = (text: string): Line => ({ text, cursor: [...text].length });

/** Applies one key. Returns `undefined` when the key is not an editing key (the caller keeps routing it). */
export function editLine({ text, cursor }: Line, k: EditKey): Edit | undefined {
  if (k.paste !== undefined) return insertPaste({ text, cursor }, k.paste);
  const cs = [...text];
  const set = (c: string[], at: number): Edit => ({ text: c.join(""), cursor: at });
  if (k.ctrl && !k.meta) {
    if (k.name === "a") return { text, cursor: 0 };
    if (k.name === "e") return { text, cursor: cs.length };
    if (k.name === "w") {
      let i = cursor;
      while (i > 0 && cs[i - 1] === " ") i--;
      while (i > 0 && cs[i - 1] !== " ") i--;
      return set([...cs.slice(0, i), ...cs.slice(cursor)], i);
    }
    return undefined;
  }
  if (k.meta) return undefined;
  switch (k.name) {
    case "left": return cursor > 0 ? { text, cursor: cursor - 1 } : { text, cursor, exit: "left" };
    case "right": return cursor < cs.length ? { text, cursor: cursor + 1 } : { text, cursor, exit: "right" };
    case "home": return { text, cursor: 0 };
    case "end": return { text, cursor: cs.length };
    case "backspace": return cursor > 0 ? set(cs.filter((_, i) => i !== cursor - 1), cursor - 1) : { text, cursor };
    case "delete": return set(cs.filter((_, i) => i !== cursor), cursor);
  }
  const s = k.sequence;
  if ([...s].length === 1 && s >= " " && s !== "\x7f") return set([...cs.slice(0, cursor), s, ...cs.slice(cursor)], cursor + 1);
  return undefined;
}

/** The part of the text that fits in `width` columns, keeping the cursor visible: `[before, under, after]`. */
export function windowLine({ text, cursor }: Line, width: number): [string, string, string] {
  const cs = [...text];
  // Room for the block at the end of the text: the cursor cell is always inside `width`.
  const w = Math.max(1, width);
  const from = Math.max(0, Math.min(cursor - w + 1, cs.length + 1 - w));
  const shown = cs.slice(from, from + w);
  const at = cursor - from;
  return [shown.slice(0, at).join(""), shown[at] ?? " ", shown.slice(at + 1).join("")];
}
