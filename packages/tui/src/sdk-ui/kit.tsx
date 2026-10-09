import { Children, useContext, type ReactNode } from "react";
import type { Component, SdkUi, Tone } from "@pvx/sdk";
import { clean } from "../palette/search.ts";
import { levelOf, meter } from "../tabs/home.ts";
import { useTheme } from "../theme-context.tsx";
import { RootPanelCtx } from "./host.tsx";
import type { Tokens } from "../theme.ts";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;

const tone = (c: Tokens, t: Tone = "text") => ({ ok: c.accent, warn: c.warn, error: c.error, info: c.info, accent: c.accent, dim: c.dim, text: c.text })[t];
/** Module text never carries ANSI or control characters into `<text>`. */
const textOf = (children: unknown) => clean(Children.toArray(children as ReactNode).map(String).join(""));

/**
 * A Panel at the page root is the page's own frame: the host already draws the border and the `› title`, so it draws
 * neither (a second border would nest inside the first). A Panel inside another Panel keeps its border and title.
 */
export function Panel({ title, tone: t, children }: Props<"Panel">) {
  const { c, g, box } = useTheme();
  const atRoot = useContext(RootPanelCtx);
  return (
    <RootPanelCtx.Provider value={false}>
      <box flexDirection="column" flexShrink={0} {...(atRoot ? {} : { paddingX: 1, ...box(t ? tone(c, t) : undefined), title: title ? `${g.query} ${clean(title)}` : undefined })}>
        {children as ReactNode}
      </box>
    </RootPanelCtx.Provider>
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

export function List({ items, selected }: Props<"List">) {
  const { c, g } = useTheme();
  const marks = items.some((it) => it.mark);
  return (
    <box flexDirection="column" flexShrink={0}>
      {items.map((it) => (
        <box key={it.id} flexShrink={0} backgroundColor={it.id === selected ? c.selected : undefined}>
          <text wrapMode="none">
            <span fg={c.accent}>{it.id === selected ? `${g.cursor} ` : "  "}</span>
            {marks ? <span fg={it.mark ? tone(c, it.mark.tone) : c.dim}>{it.mark ? `${clean(it.mark.text)} ` : "  "}</span> : null}
            <span fg={tone(c, it.tone)}>{clean(it.label)}</span>
            <span fg={c.dim}>{it.detail ? `  ${clean(it.detail)}` : ""}</span>
          </text>
        </box>
      ))}
    </box>
  );
}

export function Spacer({ size = 1 }: Props<"Spacer">) {
  return <box height={size} flexShrink={0} />;
}
