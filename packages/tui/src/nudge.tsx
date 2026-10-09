import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "./theme-context.tsx";

const SHOW_MS = 1500;
type Nudge = (msg?: string) => void;
const Ctx = createContext<Nudge>(() => {});
const Msg = createContext<string | null>(null);

/** Hosts the one notice and its one timer. Handlers call `useNudge()(msg)` when a move has no effect. */
export function NudgeProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nudge = useCallback<Nudge>((m = "nada aqui") => {
    clearTimeout(timer.current);
    setMsg(m);
    timer.current = setTimeout(() => setMsg(null), SHOW_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Ctx.Provider value={nudge}><Msg.Provider value={msg}>{children}</Msg.Provider></Ctx.Provider>;
}

/** Shows an illegal move. A no-op outside the provider. */
export const useNudge = () => useContext(Ctx);

/** The notice text, right-aligned in the footer row (reserved width is not needed: the row is already one line). */
export function NudgeText() {
  const { c } = useTheme();
  const msg = useContext(Msg);
  return msg ? <text fg={c.warn} wrapMode="none" flexShrink={0}>{`  ${msg}`}</text> : null;
}
