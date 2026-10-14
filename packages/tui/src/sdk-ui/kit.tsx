import { Children, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Component, ListItem, SdkUi, Tone } from "@pvx/sdk";
import { followProps } from "../follow.ts";
import { clean } from "../palette/search.ts";
import { columnWidths, fit, GAP, marquee, marqueeOffset, overflow } from "./columns.ts";
import { levelOf, meter } from "../tabs/home.ts";
import { useTheme } from "../theme-context.tsx";
import { HostCtx, RootPanelCtx, useKey } from "./host.tsx";
import { windowStart } from "./window.ts";
import type { Tokens } from "../theme.ts";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;

const tone = (c: Tokens, t: Tone = "text") => ({ ok: c.accent, warn: c.warn, error: c.error, info: c.info, accent: c.accent, dim: c.dim, text: c.text })[t];
const len = (s: string) => [...s].length;
/** Module text never carries ANSI or control characters into `<text>`. */
const textOf = (children: unknown) => clean(Children.toArray(children as ReactNode).map(String).join(""));

/** A shrinkable panel gives up height first (`minHeight` 0 lets it go below its content) and clips, so the host's tab bar and footer stay on screen. */
const SHRINKABLE = { flexShrink: 1, minHeight: 0, overflow: "hidden" as const };

/**
 * A Panel at the page root is the page's own frame: the host already draws the border and the `› title`, so it draws
 * neither (a second border would nest inside the first). A Panel inside another Panel keeps its border and title.
 */
export function Panel({ title, tone: t, grow, shrink, panelRef, onPress, children }: Props<"Panel">) {
  const { c, g, box } = useTheme();
  const atRoot = useContext(RootPanelCtx);
  return (
    <RootPanelCtx.Provider value={false}>
      <box ref={panelRef as never} onMouseDown={onPress ? () => onPress() : undefined} flexDirection="column" {...(shrink ? SHRINKABLE : { flexShrink: 0 })} {...(grow ? { flexGrow: 1, overflow: "hidden" as const } : {})} {...(atRoot ? {} : { paddingX: 1, ...box(t ? tone(c, t) : undefined), title: title ? `${g.query} ${clean(title)}` : undefined })}>
        {children as ReactNode}
      </box>
    </RootPanelCtx.Provider>
  );
}

export function Row({ children }: Props<"Row">) {
  return (
    <box flexDirection="row" flexShrink={0}>
      {Children.toArray(children as ReactNode).map((ch, i) => <box key={i} flexGrow={1} flexBasis={0} flexDirection="column">{ch}</box>)}
    </box>
  );
}

export function Text({ tone: t, bold, children }: Props<"Text">) {
  const { c } = useTheme();
  const s = textOf(children);
  return <text fg={tone(c, t)} flexShrink={0}>{bold ? <b>{s}</b> : s}</text>;
}

export function Chip({ label, level = "ok" }: Props<"Chip">) {
  const { c, g } = useTheme();
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={tone(c, level)}>{`${g.active} `}</span>
      <span fg={c.text}>{clean(label)}</span>
    </text>
  );
}

export function Meter({ value, width = 10, label }: Props<"Meter">) {
  const { c, g } = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const [full, empty] = meter(pct, width, g);
  return (
    <text wrapMode="none" flexShrink={0}>
      {label ? <span fg={c.dim}>{`${clean(label)} `}</span> : null}
      <span fg={tone(c, levelOf(pct))}>{full}</span>
      <span fg={c.dim}>{empty}</span>
      <span fg={c.text}>{` ${Math.round(pct)}%`}</span>
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

/** Registers `enter` for the page while a row is selected, so the footer shows the row action. */
function ActionKey({ label, selected, onAction }: { label: string; selected: string; onAction: (id: string) => void }) {
  useKey("enter", label, () => onAction(selected));
  return null;
}

export function List({ items, selected, columns, onPress, onHover, maxRows, onAction, actionLabel = DEFAULT_ACTION_LABEL, actionOnClick = true }: Props<"List">) {
  const { c, g } = useTheme();
  const [over0, setOver] = useState<string | undefined>(undefined); // the row under the mouse
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
  const lead = 2 + (marks ? 2 : 0);
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
      {onAction && selected !== undefined && inPage ? <ActionKey label={actionLabel} selected={selected} onAction={onAction} /> : null}
      {visible.map((it) => {
        const hot = it.id === over0 && it.id !== selected; // hover only tints (panel background and a dim ›): it never looks selected
        return (
        <box key={it.id} flexShrink={0} backgroundColor={it.id === selected ? c.selected : hot ? c.panel : undefined}
          onMouseOver={() => (setOver(it.id), onHover?.(it.id))} onMouseOut={() => (setOver((o) => (o === it.id ? undefined : o)), onHover?.(undefined))} onMouseDown={onPress || onAction ? () => pressRow(it.id) : undefined}>
          <text wrapMode="none">
            {it.id === selected ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{hot ? `${g.query} ` : "  "}</span>}
            {marks ? <span fg={it.mark ? tone(c, it.mark.tone) : c.dim}>{it.mark ? `${clean(it.mark.text)} ` : "  "}</span> : null}
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
            <span fg={c.dim}>{`  ${it.elapsedMs === undefined ? "" : clock(it.elapsedMs)}`}</span>
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

/** An inline result block: the level's marker and the text beside it. */
export function Notice({ level, children }: Props<"Notice">) {
  const { result, c } = useTheme();
  const { marker, color } = result(level);
  const text = textOf(children);
  return (
    <text flexShrink={0}>
      <span fg={color}>{`${marker} `}</span>
      <span fg={c.text}>{text}</span>
    </text>
  );
}
