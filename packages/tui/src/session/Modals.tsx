import { useState } from "react";
import { hintText, matchKey } from "../keymap.ts";
import { editLine, type Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useKeys } from "../keys.tsx";
import { useOver } from "../hover.ts";
import { useTheme } from "../theme-context.tsx";
import type { Pending, SessionApi } from "./store.ts";

/** Host questions of the session: destructive confirmation, masked secret input and a pick among options. Mount it wherever a run may be pending. */
export function SessionModals({ store, pending }: { store: Pick<SessionApi, "answer">; pending: readonly Pending[] }) {
  const p = pending[0];
  return p ? <Modal key={p.id} store={store} p={p} /> : null;
}

/** A clickable word of a modal: hover underlines it and turns it into the accent; a click runs `onPick`. `hot` forces the lit look (the keyboard selection). */
function Clickable({ label, onPick, onHover, hot, dim }: { label: string; onPick: () => void; onHover?: () => void; hot?: boolean; dim?: boolean }) {
  const { c } = useTheme();
  const { over: o, enter, leave } = useOver<"x">();
  const over = o !== undefined;
  const lit = over || hot;
  return (
    <box flexShrink={0} backgroundColor={hot ? c.selected : undefined} onMouseOver={() => (enter("x"), onHover?.())} onMouseOut={() => leave("x")} onMouseDown={onPick}>
      <text wrapMode="none" fg={lit ? c.accent : dim ? c.dim : c.text}>{over ? <u>{label}</u> : label}</text>
    </box>
  );
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
        <box flexDirection="row" flexShrink={0}>
          <text fg={c.text} wrapMode="none">{`confirmar \`${p.cmd}\`? `}</text>
          <Clickable label="s" onPick={() => store.answer(p.id, true)} />
          <text fg={c.dim} wrapMode="none">/</text>
          <Clickable label="N" onPick={() => store.answer(p.id, false)} />
        </box>
      ) : p.kind === "choice" ? (
        <>
          {p.lines.map((l, i) => <text key={i} fg={c.text}>{l}</text>)}
          <text> </text>
          <box flexDirection="row" flexShrink={0}>
            {p.options.map((o, i) => (
              <box key={i} flexDirection="row" flexShrink={0}>
                {i ? <text> </text> : null}
                <Clickable label={i === sel ? `[ ${o} ]` : `  ${o}  `} hot={i === sel} dim={i !== sel} onHover={() => setSel(i)} onPick={() => store.answer(p.id, i)} />
              </box>
            ))}
          </box>
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
