import { Children, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Component, ListItem, SdkUi, Tone } from "@pvx/sdk";
import { followProps } from "../follow.ts";
import { clean } from "../palette/search.ts";
import { columnWidths, fit, GAP, marquee, marqueeOffset, overflow } from "./columns.ts";
import { useTheme } from "../theme-context.tsx";
import { toneColor as tone } from "./tones.ts";
import { Button } from "./button.tsx";
import { HostCtx, useKey } from "./host.tsx";
import { windowStart } from "./window.ts";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;

const len = (s: string) => [...s].length;
/** Module text never carries ANSI or control characters into `<text>`. */
const textOf = (children: unknown) => clean(Children.toArray(children as ReactNode).map(String).join(""));

/** A shrinkable panel gives up height first (`minHeight` 0 lets it go below its content) and clips, so the host's tab bar and footer stay on screen. */
const SHRINKABLE = { flexShrink: 1, minHeight: 0, overflow: "hidden" as const };

/** `[1] rotinas` is the numbered form of a header: the number, then the label. */
const NUMBERED_TITLE = /^\[(\w+)\]\s*(.*)$/;

/** The parts of a section header: `[1] rotinas ●` gives number `1` and label `Rotinas` (the trailing active glyph is dropped: the gutter says it). */
export function headerParts(title: string, activeGlyph: string): { number?: string; label: string } {
  const cleaned = clean(title);
  const suffix = ` ${activeGlyph}`;
  const text = cleaned.endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned;
  const numbered = NUMBERED_TITLE.exec(text);
  const label = numbered ? numbered[2]! : text;
  return { number: numbered?.[1], label: label.charAt(0).toUpperCase() + label.slice(1) };
}

/** One header line: the number and the label in the tone when the section is active (bold), dim otherwise; `aside` is a dim note at the right end. */
function SectionHeader({ title, color, active, aside, inline }: { title: string; color: string; active: boolean; aside?: string; inline?: ReactNode }) {
  const { c, g } = useTheme();
  const { number, label } = headerParts(title, g.active);
  return (
    <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
      <box flexDirection="row" flexShrink={1}>
        <text wrapMode="none" flexShrink={0} fg={color}>
          {number ? `${number} ` : ""}
          {active ? <b>{label}</b> : label}
        </text>
        {inline ? <box flexDirection="row" flexShrink={1} paddingLeft={INLINE_GAP_W}>{inline}</box> : null}
      </box>
      {aside ? <text wrapMode="none" flexShrink={0} fg={c.dim}>{clean(aside)}</text> : null}
    </box>
  );
}

/** What the host's own pages add to a `Panel`; a module never sets it. */
export interface SectionExtras {
  /** A dim note at the right end of the header line (`perfil: Issabel produção`). */
  aside?: string;
  /** Content on the header line, after the label (a collapsed section: `3 Atividade   17:20 alfa confirm`). */
  inline?: ReactNode;
  /** No blank row above: sections of one line sit one under the other. */
  tight?: boolean;
}

/** Cells between the label of a section and its inline content. */
const INLINE_GAP_W = 3;

/**
 * A section of the page, never a box: a header line (`1 Rotinas`) with whitespace above it, and the content under it.
 * With `tone` the section is the active one (or needs attention): the header takes the tone and a `▌` gutter runs down its side;
 * without it the gutter is blank, so the content does not move. A Panel with neither `title` nor `tone` is a plain container.
 */
export function Panel({ title, tone: t, grow, shrink, panelRef, onPress, aside, inline, tight, children }: Props<"Panel"> & SectionExtras) {
  const { c, g } = useTheme();
  const section = title !== undefined || t !== undefined;
  const active = t !== undefined;
  const gutter = section ? { border: ["left" as const], borderColor: active ? tone(c, t) : c.bg, customBorderChars: { ...GUTTER_CHARS, vertical: active ? g.gutter : " " }, paddingLeft: 1 } : {};
  return (
    <box ref={panelRef as never} onMouseDown={onPress ? () => onPress() : undefined} flexDirection="column" {...(shrink || !section ? SHRINKABLE : { flexShrink: 0 })} {...(grow ? { flexGrow: 1, overflow: "hidden" as const } : {})} {...(title !== undefined && !tight ? { marginTop: 1 } : {})} {...gutter}>
      {title !== undefined ? <SectionHeader title={title} color={active ? tone(c, t) : c.dim} active={active} aside={aside} inline={inline} /> : null}
      {children as ReactNode}
    </box>
  );
}

/** A left border whose only drawn side is the vertical one; the other characters never show. */
const GUTTER_CHARS = { topLeft: " ", topRight: " ", bottomLeft: " ", bottomRight: " ", horizontal: " ", vertical: " ", topT: " ", bottomT: " ", leftT: " ", rightT: " ", cross: " " };

/** Children side by side. By default equal shares of the width; with `fit` each keeps its own width, `gap` cells apart, and the ones that do not fit go to the next line (a row of buttons, a line made of styled pieces). */
export function Row({ fit, gap = 0, children }: Props<"Row">) {
  const pieces = Children.toArray(children as ReactNode);
  if (fit) return <box flexDirection="row" flexWrap="wrap" flexShrink={0} columnGap={gap}>{pieces.map((piece, i) => <box key={i} flexShrink={0}>{piece}</box>)}</box>;
  return (
    <box flexDirection="row" flexShrink={0}>
      {pieces.map((ch, i) => <box key={i} flexGrow={1} flexBasis={0} flexDirection="column">{ch}</box>)}
    </box>
  );
}

export function Text({ tone: t, bold, children }: Props<"Text">) {
  const { c } = useTheme();
  const s = textOf(children);
  return <text fg={tone(c, t)} flexShrink={0}>{bold ? <b>{s}</b> : s}</text>;
}

/** The fill of a filter chip: the chosen one in the accent, the others on the `panel` token. `cursor`: the keyboard is on it (underlined). */
export function FilterChip({ label, on, cursor, onPress }: { label: string; on: boolean; cursor?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  const text = ` ${clean(label)} `;
  return (
    <box flexShrink={0} onMouseDown={onPress ? () => onPress() : undefined}>
      <text wrapMode="none" fg={on ? c.bg : c.text} bg={on ? c.accent : c.panel}>{cursor ? <u>{text}</u> : text}</text>
    </box>
  );
}

export function Chip({ label, level = "ok", state, onPress }: Props<"Chip">) {
  const { c, g } = useTheme();
  if (state) return <FilterChip label={label} on={state === "on"} onPress={onPress} />;
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={tone(c, level)}>{`${g.active} `}</span>
      <span fg={c.text}>{clean(label)}</span>
    </text>
  );
}

export function KeyHint({ keys, label }: Props<"KeyHint">) {
  const { c } = useTheme();
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={c.accent}><b>{clean(keys)}</b></span>
      <span fg={c.dim}>{` ${clean(label)}`}</span>
    </text>
  );
}

export function Table({ columns, rows }: Props<"Table">) {
  const { c } = useTheme();
  const cells = [columns, ...rows].map((r) => columns.map((_, i) => clean(String(r[i] ?? ""))));
  const w = columns.map((_, i) => Math.max(...cells.map((r) => [...r[i]!].length)));
  const line = (r: string[]) => r.map((v, i) => v.padEnd(w[i]!)).join("  ");
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={c.dim} wrapMode="none" flexShrink={0}>{line(cells[0]!)}</text>
      {cells.slice(1).map((r, i) => <text key={i} fg={c.text} wrapMode="none" flexShrink={0}>{line(r)}</text>)}
    </box>
  );
}

const DEFAULT_ACTION_LABEL = "abrir";

/** The rows of the window around the selection; `windowAt` remembers where it was so the rows hold still while the selection moves inside it. */
function visibleRows(items: ListItem[], selected: string | undefined, size: number, windowAt: { current: number }): ListItem[] {
  const selectedIndex = items.findIndex((item) => item.id === selected);
  windowAt.current = windowStart(items.length, selectedIndex, size, windowAt.current);
  return items.slice(windowAt.current, windowAt.current + size);
}

/** Whether `selected` is a row of this list. Two lists on a page may get the same `selected`: only the one that owns the row has the focus. */
function ownsSelection(items: ListItem[], selected: string | undefined): selected is string {
  return selected !== undefined && items.some((item) => item.id === selected);
}

/** Registers `enter` for the page while a row is selected, so the footer shows the row action. */
function ActionKey({ label, selected, onAction }: { label: string; selected: string; onAction: (id: string) => void }) {
  useKey("enter", label, () => onAction(selected));
  return null;
}

/** Cells of the marker column of a row: the glyph and a space. The selected `»`, the hover `›` and the blank of the other rows all take exactly this, so the columns never move. */
const CURSOR_WIDTH = 2;

export function List({ items, selected, columns, onPress, onHover, maxRows, onAction, actionLabel = DEFAULT_ACTION_LABEL, actionOnClick = true }: Props<"List">) {
  const { c, g } = useTheme();
  const [over0, setOver] = useState<string | undefined>(undefined); // the row under the mouse
  const markWidth = Math.max(0, ...items.map((it) => (it.mark ? len(clean(it.mark.text)) : 0)));
  const marks = items.some((it) => it.mark);
  const cols = columns?.length ? columns : undefined;
  const box = useRef<{ width: number } | null>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [tick, setTick] = useState({ id: selected, n: 0 });
  const windowAt = useRef(0);
  const inPage = useContext(HostCtx) !== null;
  const cell = (it: Props<"List">["items"][number], id: string) => {
    const v = it.cells?.[id];
    return { text: clean(typeof v === "string" ? v : v?.text ?? ""), tone: typeof v === "object" ? v.tone : undefined };
  };
  const lead = CURSOR_WIDTH + (marks ? markWidth + 1 : 0);
  const widths = cols ? columnWidths(cols.map((col) => ({ col, natural: Math.max(len(col.title ?? ""), ...items.map((it) => len(cell(it, col.id).text))) })), width === undefined ? undefined : Math.max(0, width - lead)) : [];
  const sel = cols ? items.find((it) => it.id === selected) : undefined;
  const over = cols && sel ? cols.map((col, i) => overflow(cell(sel, col.id).text, widths[i]!)) : [];
  const moving = over.some((n) => n > 0);
  const pause = Math.max(1, Math.round(marquee.pauseMs / marquee.stepMs));
  // One timer per list, only while the selected row has an overflowing cell.
  useEffect(() => {
    setTick({ id: selected, n: 0 });
    if (!moving) return;
    const timer = setInterval(() => setTick((t) => ({ id: selected, n: t.n + 1 })), marquee.stepMs);
    return () => clearInterval(timer);
  }, [selected, moving]);
  const n = tick.id === selected ? tick.n : 0;
  /** A click always selects; it also opens the action when `actionOnClick`, or when the row was already selected (the second click). */
  const pressRow = (id: string) => {
    const wasSelected = id === selected;
    onPress?.(id);
    if (actionOnClick || wasSelected) onAction?.(id);
  };
  const visible = maxRows === undefined ? items : visibleRows(items, selected, Math.max(0, maxRows), windowAt);
  const measure = cols ? { ref: box, onSizeChange: () => box.current && setWidth(box.current.width) } : {};
  return (
    <box flexDirection="column" flexShrink={0} {...(measure as object)}>
      {cols?.some((col) => col.title) ? (
        <text fg={c.dim} wrapMode="none" flexShrink={0}>
          {" ".repeat(lead) + cols.map((col, i) => fit(clean(col.title ?? ""), widths[i]!, col.align)).join(" ".repeat(GAP)).trimEnd()}
        </text>
      ) : null}
      {onAction && ownsSelection(items, selected) && inPage ? <ActionKey label={actionLabel} selected={selected} onAction={onAction} /> : null}
      {visible.map((it) => {
        const hot = it.id === over0 && it.id !== selected; // hover only tints (panel background and a dim ›): it never looks selected
        return (
        <box key={it.id} flexShrink={0} backgroundColor={it.id === selected ? c.selected : hot ? c.panel : undefined}
          onMouseOver={() => (setOver(it.id), onHover?.(it.id))} onMouseOut={() => (setOver((o) => (o === it.id ? undefined : o)), onHover?.(undefined))} onMouseDown={onPress || onAction ? () => pressRow(it.id) : undefined}>
          <text wrapMode="none">
            {it.id === selected ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{hot ? `${g.query} ` : " ".repeat(CURSOR_WIDTH)}</span>}
            {marks ? <span fg={it.mark ? tone(c, it.mark.tone) : c.dim}>{`${(it.mark ? clean(it.mark.text) : "").padEnd(markWidth)} `}</span> : null}
            {cols ? cols.map((col, i) => {
              const v = cell(it, col.id);
              const text = fit(v.text, widths[i]!, col.align, it.id === selected ? marqueeOffset(n, over[i]!, pause) : 0);
              return <span key={col.id} fg={tone(c, v.tone ?? it.tone)}>{i < cols.length - 1 ? text + " ".repeat(GAP) : text}</span>;
            }) : (
              <>
                <span fg={tone(c, it.tone)}>{clean(it.label ?? "")}</span>
                <span fg={c.dim}>{it.detail ? `  ${clean(it.detail)}` : ""}</span>
              </>
            )}
          </text>
        </box>
        );
      })}
    </box>
  );
}

export function Spacer({ size = 1 }: Props<"Spacer">) {
  return <box height={size} flexShrink={0} />;
}

const STEP_WORD = { pending: "pendente", running: "rodando", done: "concluído", failed: "falhou", skipped: "pulado" } as const;
const STEP_TONE: Record<keyof typeof STEP_WORD, Tone> = { pending: "dim", running: "info", done: "ok", failed: "error", skipped: "dim" };

/** `42s`, `3m05s`, `1h02m`. */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${p(s % 60)}s` : `${Math.floor(s / 3600)}h${p(Math.floor((s % 3600) / 60))}m`;
};

/** Cells of a clock (`42s`, `3m05s`, `59m59s`, `1h02m`; six at most): live times are padded to it so what follows does not move. */
export const CLOCK_W = 6;
/** `clock`, right-aligned in `CLOCK_W` cells. */
export const fixedClock = (ms: number) => clock(ms).padStart(CLOCK_W);

export function Steps({ items }: Props<"Steps">) {
  const { c, g } = useTheme();
  const [tick, setTick] = useState(0);
  const running = items.some((it) => it.state === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 100); // the spinner only moves while something runs
    return () => clearInterval(t);
  }, [running]);
  const frames = [...g.spinner];
  const glyph = { pending: g.inactive, running: frames[tick % frames.length]!, done: g.ok, failed: g.error, skipped: "-" };
  const w = Math.max(0, ...items.map((it) => len(clean(it.label))));
  const ww = Math.max(...Object.values(STEP_WORD).map(len));
  return (
    <box flexDirection="column" flexShrink={0}>
      {items.map((it) => {
        const t = STEP_TONE[it.state];
        return (
          <text key={it.id} wrapMode="none" flexShrink={0}>
            <span fg={tone(c, t)}>{`${glyph[it.state]} `}</span>
            <span fg={it.state === "pending" || it.state === "skipped" ? c.dim : c.text}>{clean(it.label).padEnd(w)}</span>
            <span fg={tone(c, t)}>{`  ${STEP_WORD[it.state].padEnd(ww)}`}</span>
            <span fg={c.dim}>{`  ${it.elapsedMs === undefined ? " ".repeat(CLOCK_W) : fixedClock(it.elapsedMs)}`}</span>
            <span fg={c.dim}>{it.detail ? `  ${clean(it.detail)}` : ""}</span>
          </text>
        );
      })}
    </box>
  );
}

/** What each key does to a focused `LogTail`. Reaching the end resumes following. */
const LOG_KEYS: Record<string, (scroll: ScrollBoxRenderable) => void> = {
  up: (scroll) => scroll.scrollBy(-1),
  down: (scroll) => scroll.scrollBy(1),
  pageup: (scroll) => scroll.scrollBy(-Math.max(1, scroll.viewport.height - 1)),
  pagedown: (scroll) => scroll.scrollBy(Math.max(1, scroll.viewport.height - 1)),
  home: (scroll) => scroll.scrollTo(0),
  end: (scroll) => scroll.scrollTo(scroll.scrollHeight),
};

/** Mounted only while the log has the keyboard. */
function LogKeys({ scroll }: { scroll: { current: ScrollBoxRenderable | null } }) {
  useKeyboard((key) => {
    const scrollTo = LOG_KEYS[key.name];
    if (scrollTo && scroll.current) scrollTo(scroll.current);
  });
  return null;
}

export function LogTail({ lines, follow = true, focused = false }: Props<"LogTail">) {
  const { c } = useTheme();
  const scroll = useRef<ScrollBoxRenderable>(null);
  return (
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} {...(follow ? followProps : {})} focused={false}>
      {focused ? <LogKeys scroll={scroll} /> : null}
      {lines.length ? lines.map((l, i) => <text key={i} fg={c.text} wrapMode="none" flexShrink={0}>{clean(l)}</text>) : <text fg={c.dim}>—</text>}
    </scrollbox>
  );
}

/** A `Notice`'s action sits at the end of the line, apart from the text, so the text can wrap without moving it. */
const NOTICE_ACTION_GAP = 2;

/** An inline result block: the level's marker and the text beside it, and an optional button at the end of the line. */
export function Notice({ level, action, children }: Props<"Notice">) {
  const { result, c } = useTheme();
  const { marker, color } = result(level);
  const text = textOf(children);
  return (
    <box flexDirection="row" flexShrink={0} columnGap={NOTICE_ACTION_GAP}>
      <box flexGrow={1} flexShrink={1}>
        <text flexShrink={0}>
          <span fg={color}>{`${marker} `}</span>
          <span fg={c.text}>{text}</span>
        </text>
      </box>
      {action ? <Button label={action.label} onPress={action.onPress} keys={action.keys} help={action.help} focused={action.focused} /> : null}
    </box>
  );
}

/** Scrolls a page taller than the screen. The keys are mounted only while it is `focused` (default). */
export function Scroll({ focused = true, children }: Props<"Scroll">) {
  const scroll = useRef<ScrollBoxRenderable>(null);
  return (
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
      {focused ? <LogKeys scroll={scroll} /> : null}
      {children as ReactNode}
    </scrollbox>
  );
}
