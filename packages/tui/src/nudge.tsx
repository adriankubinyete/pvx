import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLayout } from "./layout.ts";
import type { TokenKey } from "./theme.ts";
import { useTheme } from "./theme-context.tsx";

const SHOW_MS = 1500;
/** A toned notice (`ok`, `warn`, `error`) carries a result, so it stays longer than a refused key. */
const TONED_MS = 4000;
/** `ok`, `warn` and `error`: a result notice (glyph, theme color, stays longer). No tone: an illegal move. */
export type NudgeTone = "ok" | "warn" | "error";
type Nudge = (msg?: string, tone?: NudgeTone) => void;
interface Notice { text: string; tone?: NudgeTone }
const COLOR_BY_TONE: Record<NudgeTone, TokenKey> = { ok: "accent", warn: "warn", error: "error" };
const Ctx = createContext<Nudge>(() => {});
const Msg = createContext<Notice | null>(null);

/** Hosts the one notice and its one timer. Handlers call `useNudge()(msg)` when a move has no effect. */
export function NudgeProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nudge = useCallback<Nudge>((text = "nada aqui", tone) => {
    clearTimeout(timer.current);
    setMsg({ text, tone });
    timer.current = setTimeout(() => setMsg(null), tone ? TONED_MS : SHOW_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Ctx.Provider value={nudge}><Msg.Provider value={msg}>{children}</Msg.Provider></Ctx.Provider>;
}

/** Shows an illegal move, or (second argument `"ok"`, `"warn"` or `"error"`) a result. A no-op outside the provider. */
export const useNudge = () => useContext(Ctx);

/** True while a toned notice is up: the footer gives it the whole row. */
export const useToneNotice = () => Boolean(useContext(Msg)?.tone);

/** The notice text, right-aligned in the footer row (reserved width is not needed: the row is already one line). A toned one is cut to the row. */
export function NudgeText() {
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const msg = useContext(Msg);
  if (!msg) return null;
  if (!msg.tone) return <text fg={c.warn} wrapMode="none" flexShrink={0}>{`  ${msg.text}`}</text>;
  const text = `${g[msg.tone]} ${msg.text}`;
  const max = cols - 2; // the frame pads one column on each side
  return <text fg={c[COLOR_BY_TONE[msg.tone]]} wrapMode="none" flexShrink={0}>{text.length > max ? `${text.slice(0, max - 1)}…` : text}</text>;
}
