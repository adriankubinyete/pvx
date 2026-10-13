import { useState } from "react";
import { matchKey } from "../keymap.ts";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useScreenScope } from "../router.tsx";
import { useTheme } from "../theme-context.tsx";

/** One-line box for a repository ref. `onSubmit` resolves to an error message to show inline, or nothing when it took over the screen. */
export function AddBox({ onSubmit, onBack }: { onSubmit: (ref: string) => Promise<string | undefined>; onBack: () => void }) {
  const { c, box, g } = useTheme();
  const { cols } = useLayout();
  const [line, setLine] = useState<Line>(lineOf(""));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useScreenScope("add", 1);
  useKeys((k) => {
    if (busy) return true;
    if (k.name === "escape") return onBack(), true;
    if (matchKey(k, "enter")) {
      const ref = line.text.trim();
      if (!ref) return setErr("informe o repositório"), true;
      setErr("");
      setBusy(true);
      void onSubmit(ref).then((e) => (setBusy(false), e && setErr(e)));
      return true;
    }
    const r = editLine(line, k);
    if (r) setErr(""), setLine({ text: r.text, cursor: r.cursor });
    return true;
  });
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} adicionar módulo`}>
      <text fg={c.dim}>{" usuario/repo (GitHub) · https://… · ssh://… · git@host:caminho · id do catálogo"}</text>
      <text><span fg={c.dim}>{" repositório: "}</span><LineText line={line} focused={!busy} width={Math.max(10, cols - 20)} /></text>
      <text fg={c.error}>{err}</text>
      {busy ? <text fg={c.dim}>{" clonando…"}</text> : null}
    </box>
  );
}
