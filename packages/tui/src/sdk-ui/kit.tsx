import { Children, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Component, SdkUi, Tone } from "@pvx/sdk";
import { clean } from "../palette/search.ts";
import { columnWidths, fit, GAP, marquee, marqueeOffset, overflow } from "./columns.ts";
import { levelOf, meter } from "../tabs/home.ts";
import { useTheme } from "../theme-context.tsx";
import { RootPanelCtx } from "./host.tsx";
import type { Tokens } from "../theme.ts";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;

const tone = (c: Tokens, t: Tone = "text") => ({ ok: c.accent, warn: c.warn, error: c.error, info: c.info, accent: c.accent, dim: c.dim, text: c.text })[t];
const len = (s: string) => [...s].length;
/** Module text never carries ANSI or control characters into `<text>`. */
const textOf = (children: unknown) => clean(Children.toArray(children as ReactNode).map(String).join(""));

/**
 * A Panel at the page root is the page's own frame: the host already draws the border and the `› title`, so it draws
 * neither (a second border would nest inside the first). A Panel inside another Panel keeps its border and title.
 */
export function Panel({ title, tone: t, grow, panelRef, onPress, children }: Props<"Panel">) {
  const { c, g, box } = useTheme();
  const atRoot = useContext(RootPanelCtx);
  return (
    <RootPanelCtx.Provider value={false}>
      <box ref={panelRef as never} onMouseDown={onPress ? () => onPress() : undefined} flexDirection="column" flexShrink={0} {...(grow ? { flexGrow: 1, overflow: "hidden" as const } : {})} {...(atRoot ? {} : { paddingX: 1, ...box(t ? tone(c, t) : undefined), title: title ? `${g.query} ${clean(title)}` : undefined })}>
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

export function List({ items, selected, columns, onPress, onHover }: Props<"List">) {
  const { c, g } = useTheme();
  const [over0, setOver] = useState<string | undefined>(undefined); // the row under the mouse
  const marks = items.some((it) => it.mark);
  const cols = columns?.length ? columns : undefined;
  const box = useRef<{ width: number } | null>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [tick, setTick] = useState({ id: selected, n: 0 });
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
  const measure = cols ? { ref: box, onSizeChange: () => box.current && setWidth(box.current.width) } : {};
  return (
    <box flexDirection="column" flexShrink={0} {...(measure as object)}>
      {cols?.some((col) => col.title) ? (
        <text fg={c.dim} wrapMode="none" flexShrink={0}>
          {" ".repeat(lead) + cols.map((col, i) => fit(clean(col.title ?? ""), widths[i]!, col.align)).join(" ".repeat(GAP)).trimEnd()}
        </text>
      ) : null}
      {items.map((it) => {
        const hot = it.id === over0 && it.id !== selected; // hover only tints (panel background and a dim ›): it never looks selected
        return (
        <box key={it.id} flexShrink={0} backgroundColor={it.id === selected ? c.selected : hot ? c.panel : undefined}
          onMouseOver={() => (setOver(it.id), onHover?.(it.id))} onMouseOut={() => (setOver((o) => (o === it.id ? undefined : o)), onHover?.(undefined))} onMouseDown={onPress ? () => onPress(it.id) : undefined}>
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
