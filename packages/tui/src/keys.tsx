import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { matchKey } from "./keymap.ts";

/** Return `true` to mark the key as handled and stop routing. */
export type KeyHandler = (key: KeyEvent) => boolean | void;
interface Entry {
  fn: () => KeyHandler;
  modal: boolean;
  base: boolean;
}
const Ctx = createContext<((e: Entry) => () => void) | null>(null);

/**
 * Central keyboard routing. Ctrl+C always quits. Then handlers run newest-mounted first;
 * a `modal` handler owns the keyboard (nothing below it runs). `base` handlers run last.
 */
export function KeyRouter({ onQuit, children }: { onQuit: () => void; children: ReactNode }) {
  const entries = useRef<Entry[]>([]);
  useKeyboard((key) => {
    if (matchKey(key, "ctrl+c")) return onQuit();
    const order = [...entries.current.filter((e) => !e.base).reverse(), ...entries.current.filter((e) => e.base).reverse()];
    for (const e of order) if (e.fn()(key) === true || e.modal) return;
  });
  const register = (e: Entry) => {
    entries.current.push(e);
    return () => void (entries.current = entries.current.filter((x) => x !== e));
  };
  return <Ctx.Provider value={register}>{children}</Ctx.Provider>;
}

/** Registers a key handler for the lifetime of the component. `modal`: owns the keyboard while mounted. */
export function useKeys(handler: KeyHandler, opts: { modal?: boolean; base?: boolean } = {}) {
  const register = useContext(Ctx);
  if (!register) throw new Error("useKeys fora do KeyRouter");
  const latest = useRef(handler);
  latest.current = handler;
  const { modal = false, base = false } = opts;
  useEffect(() => register({ fn: () => latest.current, modal, base }), []);
}
