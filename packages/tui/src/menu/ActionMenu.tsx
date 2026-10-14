import { useState } from "react";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useFooterScope } from "../router.tsx";
import { useTheme } from "../theme-context.tsx";
import type { ActionId, CardAction } from "./cards.ts";

const len = (s: string) => [...s].length;

/** The popup of a card: only the actions that apply, each with its shortcut at the right. Hover selects, click runs, a click outside closes. */
export function ActionMenu({ title, actions, onPick, onClose }: { title: string; actions: CardAction[]; onPick: (id: ActionId) => void; onClose: () => void }) {
  const { c, g, box } = useTheme();
  const { cols } = useLayout();
  const [sel, setSel] = useState(0);
  useFooterScope("actions");
  // Not `modal`: a modal would also swallow ctrl+k and the other ctrl keys, which must keep working (they pass through).
  useKeys((k) => {
    if (k.ctrl && matchKey(k, "ctrl+k")) return onClose(); // the palette opens over a closed menu
    if (k.ctrl || k.meta) return;
    if (k.name === "escape") return onClose(), true;
    if (k.name === "up" || k.name === "down") return setSel((sel + (k.name === "up" ? actions.length - 1 : 1)) % actions.length), true;
    if (matchKey(k, "enter")) return actions[sel] && onPick(actions[sel]!.id), true;
    const hit = k.sequence.length === 1 ? actions.find((a) => a.key === k.sequence) : undefined;
    if (hit) onPick(hit.id);
    return true;
  });

  const labelW = Math.max(...actions.map((a) => len(a.label)));
  const inner = labelW + 2 + 3 + 3; // cursor, label, gap, state and key
  const left = Math.max(0, Math.floor((cols - (inner + 4)) / 2));
  return (
    <>
      <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={9} onMouseDown={onClose} />
      <box position="absolute" top={3} left={left} zIndex={10} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.accent)} title={`${g.active} ${title}`}>
        {actions.map((a, i) => (
          <box key={a.id} flexShrink={0} backgroundColor={i === sel ? c.selected : undefined} onMouseOver={() => setSel(i)} onMouseDown={() => onPick(a.id)}>
            <text wrapMode="none">
              <span fg={c.accent}>{i === sel ? `${g.cursor} ` : "  "}</span>
              <span fg={c.text}>{a.label.padEnd(labelW)}</span>
              <span fg={c.dim}>{"   "}</span>
              <span fg={a.state === "—" ? c.dim : c.accent}>{a.state ?? " "}</span>
              <span fg={c.accent}>{` ${a.key ?? " "}`}</span>
            </text>
          </box>
        ))}
      </box>
    </>
  );
}
