import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { KeyEvent, type PasteEvent } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { matchKey } from "./keymap.ts";

/** A key, or a paste: the paste is a key named `paste` with no sequence, and the text in `paste`. */
export type RoutedKey = KeyEvent & { paste?: string };

/** Return `true` to mark the key as handled and stop routing. */
export type KeyHandler = (key: RoutedKey) => boolean | void;
interface Entry {
  fn: () => KeyHandler;
  modal: boolean;
  base: boolean;
  /** Has a text field: the handler also receives pastes. */
  paste: boolean;
}

/** The key a handler sees for a paste. No name and no sequence match, so a shortcut never fires from it. */
export function pasteKey(text: string): RoutedKey {
  const key = new KeyEvent({ name: "paste", sequence: "", ctrl: false, meta: false, shift: false, option: false, number: false, raw: "", eventType: "press", source: "raw" });
  return Object.assign(key, { paste: text });
}

const pasteText = (event: PasteEvent) => new TextDecoder().decode(event.bytes);
const Ctx = createContext<((e: Entry) => () => void) | null>(null);

/**
 * Central keyboard routing. Ctrl+C always quits. Then handlers run newest-mounted first;
 * a `modal` handler owns the keyboard (nothing below it runs). `base` handlers run last.
 * A paste goes the same way, but only to handlers with a text field (`paste`); a modal one still stops it.
 */
export function KeyRouter({ onQuit, children }: { onQuit: () => void; children: ReactNode }) {
  const entries = useRef<Entry[]>([]);
  const inOrder = () => [...entries.current.filter((e) => !e.base).reverse(), ...entries.current.filter((e) => e.base).reverse()];
  useKeyboard((key) => {
    if (matchKey(key, "ctrl+c")) return onQuit();
    for (const e of inOrder()) if (e.fn()(key) === true || e.modal) return;
  });
  usePaste((event) => {
    const key = pasteKey(pasteText(event));
    for (const e of inOrder()) {
      const handled = e.paste && e.fn()(key) === true;
      if (handled || e.modal) return;
    }
  });
  const register = (e: Entry) => {
    entries.current.push(e);
    return () => void (entries.current = entries.current.filter((x) => x !== e));
  };
  return <Ctx.Provider value={register}>{children}</Ctx.Provider>;
}

/** Registers a key handler for the lifetime of the component. `modal`: owns the keyboard while mounted. `paste`: has a text field, so it receives pastes (`editLine` reads them). */
export function useKeys(handler: KeyHandler, opts: { modal?: boolean; base?: boolean; paste?: boolean } = {}) {
  const register = useContext(Ctx);
  if (!register) throw new Error("useKeys fora do KeyRouter");
  const latest = useRef(handler);
  latest.current = handler;
  const { modal = false, base = false, paste = false } = opts;
  useEffect(() => register({ fn: () => latest.current, modal, base, paste }), []);
}
