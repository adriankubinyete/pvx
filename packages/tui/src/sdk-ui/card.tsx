import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { CardSpec, Component, SdkUi, Tone } from "@pvx/sdk";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import { CARD_GAP, CARD_H, cardWidth, gridCols, PAGE_INSET } from "./card-layout.ts";
import { toneColor } from "./tones.ts";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;

const len = (text: string): number => [...text].length;
const cut = (text: string, width: number): string => (len(text) > width ? `${[...text].slice(0, Math.max(0, width - 1)).join("")}…` : text);

/** Columns the border and the padding take from a card. */
const CARD_CHROME = 4;
const DEFAULT_DOT = "●";

/**
 * What a card draws: the `CardSpec` of the SDK plus what only the host needs (the Módulos grid): a badge before the name,
 * a quiet name (a suggestion, not an installed thing) and the dim text at the bottom left of a card without chips.
 */
export interface CardData extends Omit<CardSpec, "state"> {
  /** Right of the name line. `dot` empty: only the text. */
  state?: { text: string; tone: Tone; dot?: string };
  badge?: { text: string; color: string };
  quiet?: boolean;
  lead?: string;
}

/** The spec a module gives: its text cleaned (module text never carries ANSI or control characters) and the defaults of the SDK applied. */
export function dataOf(spec: CardSpec): CardData {
  const { state, line2, chips, footnote, action } = spec;
  return {
    id: spec.id,
    name: clean(spec.name),
    state: state && { text: clean(state.text), tone: state.tone ?? "dim", dot: state.dot ?? DEFAULT_DOT },
    line2: line2 && { text: clean(line2.text), tone: line2.tone },
    chips: chips?.map((chip) => ({ ...chip, text: clean(chip.text) })),
    footnote: footnote === undefined ? undefined : clean(footnote),
    action: action && { key: clean(action.key), sub: action.sub === undefined ? undefined : clean(action.sub) },
  };
}

interface FaceProps {
  card: CardData;
  selected: boolean;
  /** The grid has the focus: accent border; otherwise the selected card only keeps a muted (inactive selection) one. */
  hot: boolean;
  /** The mouse is over it while the grid has no focus: a light tint, the selection stays. */
  lit: boolean;
  w: number;
  onHover: (id: string) => void;
  onLeave: (id: string) => void;
  onPick: (id: string) => void;
}

/** The chips that fit in `room` cells (each chip, a space between): the rest is dropped, the detail of the screen says everything. */
function chipsThatFit(chips: NonNullable<CardData["chips"]>, room: number): { shown: NonNullable<CardData["chips"]>; used: number } {
  const shown: NonNullable<CardData["chips"]> = [];
  let used = 0;
  for (const chip of chips) {
    const cells = len(chip.text) + 2 + (shown.length ? 1 : 0);
    if (used + cells > room) break;
    shown.push(chip);
    used += cells;
  }
  return { shown, used };
}

/** The text of the state, as it is counted in the name line: `● texto`, or the text alone when there is no dot. */
const stateCells = (state: CardData["state"]): string => (state ? `${state.dot ? `${state.dot} ` : ""}${state.text}` : "");

/** An action card: key, label and sub line, centered by hand on fixed rows so it stays visible when the card is only partly on screen. */
function ActionBody({ card, width, marked, lit }: { card: CardData; width: number; marked: boolean; lit: boolean }) {
  const { c } = useTheme();
  const action = card.action!;
  const title = `${action.key}  ${card.name}`;
  const sub = cut(action.sub ?? "", width);
  const centering = (cells: number) => " ".repeat(Math.max(0, Math.floor((width - cells) / 2)));
  const lead = centering(len(title));
  const start = marked && lead ? `${lead.slice(1)}›` : lead; // the marker takes the last padding column: nothing moves
  return (
    <>
      <text wrapMode="none"> </text>
      <text wrapMode="none"><span>{start}</span><span fg={c.accent}><b>{action.key}</b></span><span fg={c.text}>{"  "}{lit ? <u>{card.name}</u> : card.name}</span></text>
      <text wrapMode="none" fg={c.dim}>{centering(len(sub))}{sub}</text>
    </>
  );
}

/** The right of the name line: the state (dot and word) in its tone. The dot is the state's own color; the text is dim unless the tone asks for attention. */
function StateText({ state }: { state: NonNullable<CardData["state"]> }) {
  const { c } = useTheme();
  const attention = state.tone !== "ok" && state.tone !== "dim";
  const textColor = attention ? toneColor(c, state.tone) : c.dim;
  if (!state.dot) return <span fg={c.dim}>{state.text}</span>;
  return (
    <>
      <span fg={state.tone === "dim" ? c.dim : toneColor(c, state.tone)}>{state.dot}</span>
      <span fg={textColor}>{` ${state.text}`}</span>
    </>
  );
}

/** The name line: badge, name, and the state on the right. */
function NameLine({ card, width, marked, lit }: { card: CardData; width: number; marked: boolean; lit: boolean }) {
  const { c } = useTheme();
  const badgeCells = card.badge ? len(card.badge.text) : 0;
  const right = stateCells(card.state);
  const nameRoom = Math.max(1, width - badgeCells - 1 - len(right) - (right ? 1 : 0));
  const name = cut(card.name, nameRoom);
  const padding = " ".repeat(Math.max(0, width - badgeCells - 1 - len(name) - len(right)));
  const shownName = lit ? <u>{name}</u> : name;
  return (
    <text wrapMode="none">
      {card.badge ? <span fg={card.badge.color}>{card.badge.text}</span> : null}
      <span fg={card.quiet ? c.dim : c.text}>{marked ? "›" : " "}{card.quiet ? shownName : <b>{shownName}</b>}</span>
      <span>{padding}</span>
      {card.state ? <StateText state={card.state} /> : null}
    </text>
  );
}

/** One chip: colored text, or a solid chip when it needs attention. */
function ChipText({ chip }: { chip: NonNullable<CardData["chips"]>[number] }) {
  const { c } = useTheme();
  const color = toneColor(c, chip.tone);
  const fg = chip.solid ? c.bg : color;
  const bg = chip.solid ? color : chip.tone === "dim" ? undefined : c.panel;
  const padded = chip.solid || chip.tone !== "dim" ? ` ${chip.text} ` : `${chip.text}  `;
  return <span fg={fg} bg={bg}>{padded}</span>;
}

/** The bottom line: the chips (or the lead text when there are none) on the left, the footnote on the right. */
function FootLine({ card, width }: { card: CardData; width: number }) {
  const { c } = useTheme();
  const chips = card.chips ?? [];
  const footnote = card.footnote ?? "";
  const { shown, used } = chipsThatFit(chips, width - (footnote ? len(footnote) + 1 : 0));
  const lead = chips.length ? "" : card.lead ?? "";
  const gap = " ".repeat(Math.max(0, width - used - len(lead) - len(footnote)));
  return (
    <text wrapMode="none">
      {shown.map((chip, i) => <span key={chip.text}>{i ? " " : ""}<ChipText chip={chip} /></span>)}
      <span fg={c.dim}>{lead}{gap}{footnote}</span>
    </text>
  );
}

/** A card that shows something: name line, a dim second line, a gap and the foot line. */
function InfoBody({ card, width, marked, lit }: { card: CardData; width: number; marked: boolean; lit: boolean }) {
  const { c } = useTheme();
  const line2 = card.line2;
  return (
    <>
      <NameLine card={card} width={width} marked={marked} lit={lit} />
      <text wrapMode="none" fg={line2?.tone ? toneColor(c, line2.tone) : c.dim}>{cut(line2?.text ?? "", width)}</text>
      <text wrapMode="none"> </text>
      <FootLine card={card} width={width} />
    </>
  );
}

/** The dashed border of an action card: the corners of the theme, `╌` and `╎` on unicode themes. */
function dashedFrame(corners: string, unicode: boolean) {
  const [topLeft, topRight, bottomLeft, bottomRight] = [...corners];
  return { customBorderChars: { topLeft: topLeft!, topRight: topRight!, bottomLeft: bottomLeft!, bottomRight: bottomRight!, horizontal: unicode ? "╌" : "-", vertical: unicode ? "╎" : ":", topT: "+", bottomT: "+", leftT: "+", rightT: "+", cross: "+" } };
}

/** Memoized: moving the selection repaints two cards, not the grid. */
export const CardFace = memo(function CardFace({ card, selected, hot, lit, w, onHover, onLeave, onPick }: FaceProps) {
  const { c, g, box, axes } = useTheme();
  const width = w - CARD_CHROME;
  const border = box(selected ? (hot ? c.accent : c.dim) : undefined);
  const dashed = card.action !== undefined;
  const corners = axes.border === "single" ? "┌┐└┘" : g.corners;
  const frame = dashed && border.border ? dashedFrame(corners, g.hline === "─") : {};
  const marked = selected && !hot; // inactive selection: a `›` as well as the muted border (state never by color alone)
  const background = !border.border && selected ? c.selected : lit ? c.panel : undefined; // no border to show the selection: tint it
  return (
    <box id={card.id} width={w} height={CARD_H} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={background} {...border} {...frame}
      onMouseOver={() => onHover(card.id)} onMouseOut={() => onLeave(card.id)} onMouseDown={() => onPick(card.id)}>
      {dashed ? <ActionBody card={card} width={width} marked={marked} lit={lit} /> : <InfoBody card={card} width={width} marked={marked} lit={lit} />}
    </box>
  );
});

export interface CardGridProps {
  cards: CardData[];
  /** Id of the selected card (selection by id, never by index); the first one when unknown. */
  sel?: string;
  onSel: (id: string) => void;
  onActivate: (id: string) => void;
  /** Up on the first row: focus goes to the tab bar. */
  onTop?: () => void;
  focused: boolean;
  /** Shown instead of the cards when there are none (text, or a node such as `Loading`). */
  empty?: ReactNode;
  /** Columns the screen around the grid takes besides the tab frame (a module page: `PAGE_INSET`). */
  inset?: number;
}

const ARROW_STEP: Record<string, (columns: number) => number> = { up: (columns) => -columns, down: (columns) => columns, left: () => -1, right: () => 1 };

/** The message of an arrow that finds no card. */
function edgeMessage(count: number, step: number): string {
  if (!count) return "nada aqui";
  return step < 0 ? "início da lista" : "fim da lista";
}

/** Cards in a grid: arrows, enter, mouse, scroll to the selected one. 3 columns from 120 terminal columns, 2 from 80, else 1. */
export function CardGrid({ cards, sel, onSel, onActivate, onTop, focused, empty, inset = 0 }: CardGridProps) {
  const { c } = useTheme();
  const { cols } = useLayout();
  const nudge = useNudge();
  const scroll = useRef<ScrollBoxRenderable>(null);
  const columns = gridCols(cols);
  const width = cardWidth(cols, inset);
  const index = Math.max(0, cards.findIndex((card) => card.id === sel));
  const current = cards[index];
  const rows: CardData[][] = [];
  for (let i = 0; i < cards.length; i += columns) rows.push(cards.slice(i, i + columns));
  useEffect(() => {
    if (!current) return;
    const toSelected = () => scroll.current?.scrollChildIntoView(`row:${Math.floor(index / columns)}`);
    toSelected();
    const later = setTimeout(toSelected, 0); // rows that just appeared (the catalog switch) have no layout yet: once more after it
    return () => clearTimeout(later);
  }, [current?.id, cards, columns]);

  // Mouse callbacks stay stable (cards are memoized) and read the latest state through the ref.
  const latest = useRef({ onSel, onActivate, focused });
  latest.current = { onSel, onActivate, focused };
  // Hover moves the selection while the grid has the focus; without it, hover only tints the card. A click selects and focuses (Tabs does the focus).
  const [over, setOver] = useState<string>();
  const hover = useCallback((id: string) => (latest.current.focused ? latest.current.onSel(id) : setOver(id)), []);
  const leave = useCallback((id: string) => setOver((now) => (now === id ? undefined : now)), []);
  const pick = useCallback((id: string) => {
    latest.current.onSel(id);
    latest.current.onActivate(id);
  }, []);

  /** The card an arrow reaches from the selected one; a shorter last row is reached from the row above. */
  const arrowTarget = (name: string, step: number): number => {
    const target = index + step;
    const lastRow = Math.floor((cards.length - 1) / columns);
    const stepsOffEnd = name === "down" && target >= cards.length && Math.floor(index / columns) < lastRow;
    return stepsOffEnd ? cards.length - 1 : target;
  };
  const onArrow = (name: string): true => {
    const step = ARROW_STEP[name]!(columns);
    if (name === "up" && index < columns && onTop) {
      onTop();
      return true;
    }
    const next = cards[arrowTarget(name, step)];
    if (next) onSel(next.id);
    else nudge(edgeMessage(cards.length, step));
    return true;
  };
  useKeys((key) => {
    if (!focused) return;
    if (Object.hasOwn(ARROW_STEP, key.name) && !key.ctrl && !key.shift) return onArrow(key.name);
    if (matchKey(key, "enter")) {
      if (current) onActivate(current.id);
      return true;
    }
  });

  return (
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
      {!cards.length && empty ? <box paddingX={1} flexShrink={0}>{typeof empty === "string" ? <text fg={c.dim}>{empty}</text> : empty}</box> : null}
      {rows.map((row, i) => (
        <box key={i} id={`row:${i}`} flexDirection="row" flexShrink={0} height={CARD_H} gap={CARD_GAP}>
          {row.map((card) => <CardFace key={card.id} card={card} selected={card.id === current?.id} hot={focused && card.id === current?.id} lit={!focused && card.id === over} w={width} onHover={hover} onLeave={leave} onPick={pick} />)}
        </box>
      ))}
    </scrollbox>
  );
}

const nothing = () => {};

/** `sdk.ui.Card`: one card, drawn in the state the page gives it (a sheet of states; a page that navigates uses `CardGrid`). */
export function Card({ card, state = "normal", width, onPress }: Props<"Card">) {
  const { cols } = useLayout();
  const data = dataOf(card);
  return <CardFace card={data} selected={state !== "normal"} hot={state === "selected"} lit={false} w={width ?? cardWidth(cols, PAGE_INSET)} onHover={nothing} onLeave={nothing} onPick={() => onPress?.()} />;
}

/** `sdk.ui.CardGrid`: the cards of a module in the grid of the host, with the keyboard of the Módulos tab. */
export function SdkCardGrid({ cards, selected, onSelect, onActivate, focused, onTop, empty }: Props<"CardGrid">) {
  return <CardGrid cards={cards.map(dataOf)} sel={selected} onSel={onSelect} onActivate={onActivate} onTop={onTop} focused={focused} empty={empty as ReactNode} inset={PAGE_INSET} />;
}
