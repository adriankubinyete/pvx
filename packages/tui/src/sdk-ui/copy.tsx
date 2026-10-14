import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClipboard, createHostClipboard, createRendererClipboardAdapter, type CliRenderer } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";

/** Writes `text` to the clipboard. `ok: false` carries the reason. */
export type ClipboardWrite = (text: string) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** Host + OSC 52: the terminal path alone fails under tmux and SSH. */
export async function writeClipboard(renderer: CliRenderer, text: string): ReturnType<ClipboardWrite> {
  const clip = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) });
  try {
    const r = await clip.writeText(text, { destination: "best-available" });
    if (r.host.status === "written" || r.terminal.status === "attempted") return { ok: true };
    return { ok: false, reason: r.host.status === "failed" ? r.host.error.message : "sem área de transferência no sistema nem no terminal (OSC 52)" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  } finally {
    void clip.dispose();
  }
}

interface Preview {
  title: string;
  lines: string[];
  ok: boolean | undefined;
}
interface Copier {
  copy(text: string, opts?: { title?: string }): Promise<boolean>;
  preview: Preview | null;
}
const Ctx = createContext<Copier>({ copy: async () => false, preview: null });

export const PREVIEW_MS = 4000;

/** Hosts `useCopy` and the one preview panel. `clipboard` and `previewMs` exist for tests. */
export function CopyProvider({ children, clipboard, previewMs = PREVIEW_MS }: { children: ReactNode; clipboard?: ClipboardWrite; previewMs?: number }) {
  const renderer = useRenderer();
  const nudge = useNudge();
  const [preview, setPreview] = useState<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string, opts?: { title?: string }) => {
    const title = opts?.title ?? "copiado";
    clearTimeout(timer.current);
    setPreview({ title, lines: text.split("\n"), ok: undefined });
    const r = await (clipboard ?? ((t) => writeClipboard(renderer, t)))(text);
    setPreview({ title: r.ok ? title : "não copiado", lines: text.split("\n"), ok: r.ok });
    timer.current = setTimeout(() => setPreview(null), previewMs);
    if (r.ok) nudge("copiado", "ok");
    else nudge(`não copiou: ${r.reason}`);
    return r.ok;
  }, [clipboard, renderer, nudge, previewMs]);
  const value = useMemo(() => ({ copy, preview }), [copy, preview]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCopy = () => useContext(Ctx).copy;

const MAX_LINES = 8;

/** The transient panel of what `copy` put on the clipboard: dim border, the lines as they are (cut to the width, at most 8). */
export function CopyPreview() {
  const { c, g, box } = useTheme();
  const { cols } = useLayout();
  const p = useContext(Ctx).preview;
  if (!p) return null;
  const max = cols - 10;
  const cut = (l: string) => (l.length > max ? `${l.slice(0, max - 1)}…` : l);
  const lines = p.lines.slice(0, MAX_LINES).map((l) => cut(clean(l)));
  const more = p.lines.length - lines.length;
  return (
    <box position="absolute" bottom={0} left={2} zIndex={9} minWidth={[...clean(p.title)].length + 6} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(p.ok === false ? c.warn : c.dim)} title={`${p.ok === false ? g.warn : g.ok} ${clean(p.title)}`}>
      {lines.map((l, i) => <text key={i} fg={c.dim} wrapMode="none" flexShrink={0}>{l || " "}</text>)}
      {more > 0 ? <text fg={c.dim} wrapMode="none" flexShrink={0}>{`… mais ${more} linha${more > 1 ? "s" : ""}`}</text> : null}
    </box>
  );
}
