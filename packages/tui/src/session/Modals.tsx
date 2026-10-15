import { useState } from "react";
import { hintText, matchKey } from "../keymap.ts";
import { editLine, type Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useKeys } from "../keys.tsx";
import { useTheme } from "../theme-context.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import type { Pending, SessionApi } from "./store.ts";

/** Host questions of the session: destructive confirmation, masked secret input and a pick among options. Mount it wherever a run may be pending. */
export function SessionModals({ store, pending }: { store: Pick<SessionApi, "answer">; pending: readonly Pending[] }) {
  const p = pending[0];
  return p ? <Modal key={p.id} store={store} p={p} /> : null;
}

/** Button positions of a confirm dialog. */
const CONFIRM_BUTTON = 0;
const CANCEL_BUTTON = 1;

/** The confirm dialog of a pending `confirm`: confirm on the left, cancel on the right, focus on the cancel (the safe one). */
function ConfirmModal({ store, p }: { store: Pick<SessionApi, "answer">; p: Extract<Pending, { kind: "confirm" }> }) {
  const description = typeof p.description === "string" ? [p.description] : p.description;
  return (
    <ConfirmDialog
      title={p.title} description={description} buttons={[p.confirmLabel ?? "confirmar", p.cancelLabel ?? "cancelar"]} initial={CANCEL_BUTTON}
      destructive={p.destructive ? CONFIRM_BUTTON : undefined} onPick={(index) => store.answer(p.id, index === CONFIRM_BUTTON)} onCancel={() => store.answer(p.id, false)}
    />
  );
}

/** The choice dialog: the options are the buttons, the first is the safe one (focus and `esc`). */
function ChoiceModal({ store, p }: { store: Pick<SessionApi, "answer">; p: Extract<Pending, { kind: "choice" }> }) {
  return <ConfirmDialog title={p.title} description={p.lines} buttons={p.options} initial={0} onPick={(index) => store.answer(p.id, index)} onCancel={() => store.answer(p.id, 0)} />;
}

function Modal({ store, p }: { store: Pick<SessionApi, "answer">; p: Pending }) {
  if (p.kind === "confirm") return <ConfirmModal store={store} p={p} />;
  if (p.kind === "choice") return <ChoiceModal store={store} p={p} />;
  return <SecretModal store={store} p={p} />;
}

function SecretModal({ store, p }: { store: Pick<SessionApi, "answer">; p: Extract<Pending, { kind: "secret" }> }) {
  const { c, box, g } = useTheme();
  // The secret lives only in this state; it goes to `answer` and nowhere else.
  const [secret, setSecret] = useState<Line>({ text: "", cursor: 0 });
  useKeys((k) => {
    if (k.name === "escape") return store.answer(p.id, undefined);
    if (matchKey(k, "enter")) return store.answer(p.id, secret.text || undefined);
    const r = editLine(secret, k);
    if (r) setSecret({ text: r.text, cursor: r.cursor });
  }, { modal: true, paste: true });
  return (
    <box position="absolute" top={2} left={4} zIndex={10} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.warn)} title={`${g.warn} segredo`}>
      <text fg={c.text}>{`${p.name}:`}</text>
      <text><LineText line={secret} focused width={30} mask fg={c.accent} /></text>
      <text fg={c.dim}>{hintText("modal", "enter", "esc")}</text>
    </box>
  );
}
