import { memo, useCallback, useEffect, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useTheme } from "../theme-context.tsx";
import type { Item } from "./tree.ts";

export const LABEL_W = 22;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

interface RowProps { item: Item; selected: boolean; helpW: number; onHover: (id: string) => void; onPick: (id: string) => void }

/** Memoized: moving the selection repaints two rows, not the list. */
const Row = memo(function Row({ item, selected, helpW, onHover, onPick }: RowProps) {
  const { c, g } = useTheme();
  return (
    <box id={item.id} flexDirection="row" flexShrink={0} paddingX={1} backgroundColor={selected ? c.selected : undefined}
      onMouseOver={() => onHover(item.id)} onMouseDown={() => onPick(item.id)}>
      <box width={LABEL_W} flexShrink={0}>
        <text>
          <span fg={c.accent}>{selected ? `${g.cursor} ` : "  "}</span>
          {item.errorOf ? <span fg={c.error}>{`${g.error} `}</span> : null}
          <span fg={item.errorOf ? c.error : c.text}>{cut(item.label, LABEL_W - 6)}</span>
          {item.destructive ? <span fg={c.error}>{" !"}</span> : null}
        </text>
      </box>
      <text fg={c.dim}>{cut(item.help, helpW)}</text>
    </box>
  );
});

export interface ItemListProps {
  items: Item[];
  /** Id of the selected row (selection by id, never by index); the first row when unknown. */
  sel?: string;
  onSel: (id: string) => void;
  onActivate: (item: Item) => void;
  /** Up on the first row: focus goes to the tab bar. */
  onTop?: () => void;
  focused: boolean;
  title: string;
  helpW: number;
}

/** Selectable rows with a cursor: arrows, enter, mouse, scroll to the cursor. The one list of the menu and the modules tab. */
export function ItemList({ items, sel, onSel, onActivate, onTop, focused, title, helpW }: ItemListProps) {
  const { box } = useTheme();
  const scroll = useRef<ScrollBoxRenderable>(null);
  const cur = items.find((i) => i.id === sel) ?? items[0];
  useEffect(() => {
    if (cur) scroll.current?.scrollChildIntoView(cur.id);
  }, [cur?.id, items]);

  // Mouse callbacks stay stable (rows are memoized) and read the latest state through the ref.
  const latest = useRef({ onSel, onActivate, items });
  latest.current = { onSel, onActivate, items };
  const hover = useCallback((id: string) => latest.current.onSel(id), []);
  const pick = useCallback((id: string) => {
    const l = latest.current;
    l.onSel(id);
    l.onActivate(l.items.find((i) => i.id === id)!);
  }, []);

  useKeys((k) => {
    if (!focused) return;
    if (k.name === "up" || k.name === "down") {
      const i = items.findIndex((x) => x.id === cur?.id);
      if (k.name === "up" && i <= 0 && onTop) return onTop(), true;
      return onSel(items[Math.max(0, Math.min(items.length - 1, i + (k.name === "up" ? -1 : 1)))]?.id ?? ""), true;
    }
    if (matchKey(k, "enter")) return cur && onActivate(cur), true;
  });

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={title}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
        {items.map((i) => <Row key={i.id} item={i} selected={focused && i.id === cur?.id} helpW={helpW} onHover={hover} onPick={pick} />)}
      </scrollbox>
    </box>
  );
}
