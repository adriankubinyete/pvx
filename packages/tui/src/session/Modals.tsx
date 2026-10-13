import { useState } from "react";
import { hintText, matchKey } from "../keymap.ts";
import { editLine, type Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useKeys } from "../keys.tsx";
import { useTheme } from "../theme-context.tsx";
import type { Pending, SessionApi } from "./store.ts";

/** Host questions of the session: destructive confirmation, masked secret input and a pick among options. Mount it wherever a run may be pending. */
export function SessionModals({ store, pending }: { store: Pick<SessionApi, "answer">; pending: readonly Pending[] }) {
  const p = pending[0];
  return p ? <Modal key={p.id} store={store} p={p} /> : null;
}

function Modal({ store, p }: { store: Pick<SessionApi, "answer">; p: Pending }) {
  const { c, box, g } = useTheme();
  // The secret lives only in this state; it goes to `answer` and nowhere else.
  const [secret, setSecret] = useState<Line>({ text: "", cursor: 0 });
  const [sel, setSel] = useState(0);
  useKeys((k) => {
    if (p.kind === "choice") {
      const n = p.options.length;
      if (matchKey(k, "enter")) store.answer(p.id, sel);
      else if (k.name === "escape") store.answer(p.id, 0);
      else if (k.name === "right" || (k.name === "tab" && !k.shift)) setSel((sel + 1) % n);
      else if (k.name === "left" || (k.name === "tab" && k.shift)) setSel((sel + n - 1) % n);
      return;
    }
    if (p.kind === "confirm") return store.answer(p.id, /^[sS]$/.test(k.sequence));
    if (k.name === "escape") return store.answer(p.id, undefined);
    if (matchKey(k, "enter")) return store.answer(p.id, secret.text || undefined);
    const r = editLine(secret, k);
    if (r) setSecret({ text: r.text, cursor: r.cursor });
  }, { modal: true });
  return (
    <box position="absolute" top={2} left={4} zIndex={10} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.warn)} title={`${g.warn} ${p.kind === "choice" ? p.title : p.kind === "confirm" ? "confirmar" : "segredo"}`}>
      {p.kind === "confirm" ? (
        <text fg={c.text}>{`confirmar \`${p.cmd}\`? s/N`}</text>
      ) : p.kind === "choice" ? (
        <>
          {p.lines.map((l, i) => <text key={i} fg={c.text}>{l}</text>)}
          <text> </text>
          <text>
            {p.options.map((o, i) => (
              <span key={i}>
                {i ? " " : ""}
                <span fg={i === sel ? c.accent : c.dim} bg={i === sel ? c.selected : undefined}>{i === sel ? `[ ${o} ]` : `  ${o}  `}</span>
              </span>
            ))}
          </text>
        </>
      ) : (
        <>
          <text fg={c.text}>{`${p.name}:`}</text>
          <text><LineText line={secret} focused width={30} mask fg={c.accent} /></text>
          <text fg={c.dim}>{hintText("modal", "enter", "esc")}</text>
        </>
      )}
    </box>
  );
}
