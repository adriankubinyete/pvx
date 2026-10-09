import { useState } from "react";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useTheme } from "../theme-context.tsx";
import type { Pending, SessionApi } from "./store.ts";

/** Host questions of the session: destructive confirmation and masked secret input. Mount it wherever a run may be pending. */
export function SessionModals({ store, pending }: { store: SessionApi; pending: readonly Pending[] }) {
  const p = pending[0];
  return p ? <Modal key={p.id} store={store} p={p} /> : null;
}

function Modal({ store, p }: { store: SessionApi; p: Pending }) {
  const { c, box, g } = useTheme();
  // The secret lives only in this state; it goes to `answer` and nowhere else.
  const [secret, setSecret] = useState("");
  useKeys((k) => {
    if (p.kind === "confirm") return store.answer(p.id, /^[sS]$/.test(k.sequence));
    if (k.name === "escape") return store.answer(p.id, undefined);
    if (matchKey(k, "enter")) return store.answer(p.id, secret || undefined);
    if (k.name === "backspace") return setSecret((s) => [...s].slice(0, -1).join(""));
    if ([...k.sequence].length === 1 && k.sequence >= " " && !k.ctrl && !k.meta) setSecret((s) => s + k.sequence);
  }, { modal: true });
  return (
    <box position="absolute" top={2} left={4} zIndex={10} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.warn)} title={`${g.warn} ${p.kind === "confirm" ? "confirmar" : "segredo"}`}>
      {p.kind === "confirm" ? (
        <text fg={c.text}>{`confirmar \`${p.cmd}\`? s/N`}</text>
      ) : (
        <>
          <text fg={c.text}>{`${p.name}:`}</text>
          <text fg={c.accent}>{"*".repeat([...secret].length)}</text>
          <text fg={c.dim}>enter envia · esc cancela</text>
        </>
      )}
    </box>
  );
}
