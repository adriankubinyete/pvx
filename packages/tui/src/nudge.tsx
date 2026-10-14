import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLayout } from "./layout.ts";
import { useTheme } from "./theme-context.tsx";

const SHOW_MS = 1500;
const OK_MS = 4000;
/** `ok`: a success notice (accent marker, stays longer). Default: an illegal move. */
type Nudge = (msg?: string, tone?: "ok") => void;
interface Notice { text: string; ok: boolean }
const Ctx = createContext<Nudge>(() => {});
const Msg = createContext<Notice | null>(null);

/** Hosts the one notice and its one timer. Handlers call `useNudge()(msg)` when a move has no effect. */
export function NudgeProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nudge = useCallback<Nudge>((m = "nada aqui", tone) => {
    clearTimeout(timer.current);
    setMsg({ text: m, ok: tone === "ok" });
    timer.current = setTimeout(() => setMsg(null), tone === "ok" ? OK_MS : SHOW_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Ctx.Provider value={nudge}><Msg.Provider value={msg}>{children}</Msg.Provider></Ctx.Provider>;
}

/** Shows an illegal move, or (second argument "ok") a success. A no-op outside the provider. */
export const useNudge = () => useContext(Ctx);

/** True while a success notice is up: the footer gives it the whole row. */
export const useNoticeOk = () => useContext(Msg)?.ok ?? false;

/** The notice text, right-aligned in the footer row (reserved width is not needed: the row is already one line). A success one is cut to the row. */
export function NudgeText() {
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const msg = useContext(Msg);
  if (!msg) return null;
  if (!msg.ok) return <text fg={c.warn} wrapMode="none" flexShrink={0}>{`  ${msg.text}`}</text>;
  const text = `${g.ok} ${msg.text}`;
  const max = cols - 2; // the frame pads one column on each side
  return <text fg={c.accent} wrapMode="none" flexShrink={0}>{text.length > max ? `${text.slice(0, max - 1)}…` : text}</text>;
}
