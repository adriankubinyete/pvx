import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { useTheme } from "../theme-context.tsx";
import { CARD_GAP, CARD_H, gridCols, type Card, type Chip } from "./cards.ts";
import type { Tone } from "./tree.ts";

const len = (s: string) => [...s].length;
const cut = (s: string, n: number) => (len(s) > n ? `${[...s].slice(0, Math.max(0, n - 1)).join("")}…` : s);

interface CardProps { card: Card; selected: boolean; /** The grid has the focus: accent border; otherwise the selected card only keeps a muted (inactive selection) one. */ hot: boolean; /** The mouse is over it while the grid has no focus: a light tint, the selection stays. */ lit: boolean; w: number; onHover: (id: string) => void; onLeave: (id: string) => void; onPick: (id: string) => void }

/** Memoized: moving the selection repaints two cards, not the grid. */
const CardView = memo(function CardView({ card, selected, hot, lit, w, onHover, onLeave, onPick }: CardProps) {
  const { c, g, box, axes } = useTheme();
  const tone: Record<Tone, string> = { ok: c.accent, warn: c.warn, error: c.error, info: c.info, dim: c.dim };
  const iw = w - 4; // border and padding
  const b = box(selected ? (hot ? c.accent : c.dim) : undefined);
  const dashed = card.kind === "add" || card.kind === "open";
  const [tl, tr, bl, br] = [...(axes.border === "single" ? "┌┐└┘" : g.corners)];
  const unicode = g.hline === "─";
  const frame = dashed && b.border
    ? { customBorderChars: { topLeft: tl!, topRight: tr!, bottomLeft: bl!, bottomRight: br!, horizontal: unicode ? "╌" : "-", vertical: unicode ? "╎" : ":", topT: "+", bottomT: "+", leftT: "+", rightT: "+", cross: "+" } }
    : {};
  const marked = selected && !hot; // inactive selection: a `›` as well as the muted border (state never by color alone)
  const back = !b.border && selected ? c.selected : lit ? c.panel : undefined; // no border to show the selection: tint it

  let body: React.ReactNode;
  if (dashed) {
    // Centered by hand, on fixed rows: it stays visible when the card is only partly on screen.
    const title = `${card.key}  ${card.name}`;
    const sub = cut(card.sub ?? "", iw);
    const mid = (n: number) => " ".repeat(Math.max(0, Math.floor((iw - n) / 2)));
    const lead = mid(len(title));
    const at = marked && lead ? `${lead.slice(1)}›` : lead; // the marker takes the last padding column: nothing moves
    body = (
      <>
        <text wrapMode="none"> </text>
        <text wrapMode="none"><span>{at}</span><span fg={c.accent}><b>{card.key}</b></span><span fg={c.text}>{"  "}{lit ? <u>{card.name}</u> : card.name}</span></text>
        <text wrapMode="none" fg={c.dim}>{mid(len(sub))}{sub}</text>
      </>
    );
  } else {
    const isCat = card.kind === "catalog";
    const badge: [string, string] = card.origin === "official" ? [g.official, c.accent] : card.origin === "dev" || card.origin === "embedded" ? ["dev", c.warn] : [g.thirdParty, c.thirdParty];
    const right = isCat ? (card.version ?? "") : card.state ? `${card.state.dot} ${card.state.text}` : "";
    const nameW = Math.max(1, iw - len(badge[0]) - 1 - len(right) - (right ? 1 : 0));
    const name = cut(card.name, nameW);
    const pad = " ".repeat(Math.max(0, iw - len(badge[0]) - 1 - len(name) - len(right)));
    const stateTone = card.state && card.state.tone !== "ok" && card.state.tone !== "dim" ? tone[card.state.tone] : c.dim;

    // Chips that fit next to the version; the rest is dropped (the detail strip says everything).
    const ver = isCat ? "" : card.version ?? "";
    const room = iw - (ver ? len(ver) + 1 : 0);
    const chips: Chip[] = [];
    let used = 0;
    for (const ch of card.chips) {
      const n = len(ch.text) + 2 + (chips.length ? 1 : 0);
      if (used + n > room) break;
      chips.push(ch);
      used += n;
    }
    const lead = !chips.length && card.official && !isCat ? "oficial" : "";
    const showVer = isCat ? "" : ver; // the version is always on the right
    const gap = " ".repeat(Math.max(0, iw - used - len(lead) - len(showVer)));
    body = (
      <>
        <text wrapMode="none">
          <span fg={badge[1]}>{badge[0]}</span>
          <span fg={isCat ? c.dim : c.text}>{marked ? "›" : " "}{(() => { const nm = lit ? <u>{name}</u> : name; return isCat ? nm : <b>{nm}</b>; })()}</span>
          <span>{pad}</span>
          {isCat ? <span fg={c.dim}>{right}</span> : card.state ? <><span fg={card.state.tone === "dim" ? c.dim : tone[card.state.tone]}>{card.state.dot}</span><span fg={stateTone}>{` ${card.state.text}`}</span></> : null}
        </text>
        <text wrapMode="none" fg={card.line2.tone ? tone[card.line2.tone] : c.dim}>{cut(card.line2.text, iw)}</text>
        <text wrapMode="none"> </text>
        <text wrapMode="none">
          {chips.map((ch, i) => (
            <span key={ch.text}>
              {i ? " " : ""}
              <span fg={ch.solid ? c.bg : tone[ch.tone]} bg={ch.solid ? tone[ch.tone] : ch.tone === "dim" ? undefined : c.panel}>{ch.solid || ch.tone !== "dim" ? ` ${ch.text} ` : `${ch.text}  `}</span>
            </span>
          ))}
          <span fg={c.dim}>{lead}{gap}{showVer}</span>
        </text>
      </>
    );
  }
  return (
    <box id={card.id} width={w} height={CARD_H} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={back} {...b} {...frame}
      onMouseOver={() => onHover(card.id)} onMouseOut={() => onLeave(card.id)} onMouseDown={() => onPick(card.id)}>
      {body}
    </box>
  );
});

export interface CardGridProps {
  cards: Card[];
  /** Id of the selected card (selection by id, never by index); the first one when unknown. */
  sel?: string;
  onSel: (id: string) => void;
  onActivate: (card: Card) => void;
  /** Up on the first row: focus goes to the tab bar. */
  onTop?: () => void;
  focused: boolean;
  /** Shown instead of the cards when there are none (text, or a node such as `Loading`). */
  empty?: ReactNode;
}

/** Cards in a grid: arrows, enter, mouse, scroll to the selected one. 3 columns from 120 terminal columns, 2 from 80, else 1. */
export function CardGrid({ cards, sel, onSel, onActivate, onTop, focused, empty }: CardGridProps) {
  const { c } = useTheme();
  const { cols } = useLayout();
  const nudge = useNudge();
  const scroll = useRef<ScrollBoxRenderable>(null);
  const n = gridCols(cols);
  const w = Math.floor((cols - 3 - (n - 1) * CARD_GAP) / n); // frame padding and the scrollbar column
  const idx = Math.max(0, cards.findIndex((x) => x.id === sel));
  const cur = cards[idx];
  const lines: Card[][] = [];
  for (let i = 0; i < cards.length; i += n) lines.push(cards.slice(i, i + n));
  useEffect(() => {
    if (!cur) return;
    const to = () => scroll.current?.scrollChildIntoView(`row:${Math.floor(idx / n)}`);
    to();
    const t = setTimeout(to, 0); // rows that just appeared (the catalog switch) have no layout yet: once more after it
    return () => clearTimeout(t);
  }, [cur?.id, cards, n]);

  // Mouse callbacks stay stable (cards are memoized) and read the latest state through the ref.
  const latest = useRef({ onSel, onActivate, cards, focused });
  latest.current = { onSel, onActivate, cards, focused };
  // Hover moves the selection while the grid has the focus; without it, hover only tints the card. A click selects and focuses (Tabs does the focus).
  const [over, setOver] = useState<string>();
  const hover = useCallback((id: string) => (latest.current.focused ? latest.current.onSel(id) : setOver(id)), []);
  const leave = useCallback((id: string) => setOver((o) => (o === id ? undefined : o)), []);
  const pick = useCallback((id: string) => {
    const l = latest.current;
    l.onSel(id);
    l.onActivate(l.cards.find((x) => x.id === id)!);
  }, []);

  useKeys((k) => {
    if (!focused) return;
    const dir = k.name === "up" ? -n : k.name === "down" ? n : k.name === "left" ? -1 : k.name === "right" ? 1 : 0;
    if (dir && !k.ctrl && !k.shift) {
      if (k.name === "up" && idx < n && onTop) return onTop(), true;
      let to = idx + dir;
      if (k.name === "down" && to >= cards.length && Math.floor(idx / n) < Math.floor((cards.length - 1) / n)) to = cards.length - 1; // a shorter last row
      const next = cards[to];
      return next ? onSel(next.id) : nudge(!cards.length ? "nada aqui" : dir < 0 ? "início da lista" : "fim da lista"), true;
    }
    if (matchKey(k, "enter")) return cur && onActivate(cur), true;
  });

  return (
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
      {!cards.length && empty ? <box paddingX={1} flexShrink={0}>{typeof empty === "string" ? <text fg={c.dim}>{empty}</text> : empty}</box> : null}
      {lines.map((line, i) => (
        <box key={i} id={`row:${i}`} flexDirection="row" flexShrink={0} height={CARD_H} gap={CARD_GAP}>
          {line.map((card) => <CardView key={card.id} card={card} selected={card.id === cur?.id} hot={focused && card.id === cur?.id} lit={!focused && card.id === over} w={w} onHover={hover} onLeave={leave} onPick={pick} />)}
        </box>
      ))}
    </scrollbox>
  );
}
