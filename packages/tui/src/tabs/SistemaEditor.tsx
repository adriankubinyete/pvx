import { useEffect, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { matchKey } from "../keymap.ts";
import { useKeys, type RoutedKey } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useOver } from "../hover.ts";
import { useNudge } from "../nudge.tsx";
import { useScreenScope } from "../router.tsx";
import { useTheme } from "../theme-context.tsx";
import { contrast, hexTokensFor, normalizeHex, TEXT_TOKENS, TOKEN_KEYS, type HexTokens, type ThemeName, type TokenKey } from "../theme.ts";
import { meter } from "./home.ts";
import { cycle, type Options } from "./sistema.ts";

/** The themes with known hex values: the ones "começar de" can copy. */
const SOURCES: Options = [["dark", "Escuro"], ["light", "Claro"], ["contrast", "Alto contraste"]];
/** The id of the "começar de" row; the tokens have their own names, and none of them is this. */
const FROM = "from";
const LABEL_W = 14;
const PREVIEW_W = 34;
const MIN_LIST_W = 40;
const HEX_W = 9;

/** The preview of the theme being edited: the four result lines, a chip, a meter and the focus frame. */
function Preview() {
  const { c, g, box, result } = useTheme();
  const [full, empty] = meter(60, 10, g);
  const samples = { ok: "operação concluída", warn: "revise isto", error: "falhou", info: "para saber mais" } as const;
  return (
    <box width={PREVIEW_W} flexShrink={0} flexDirection="column" paddingX={1} overflow="hidden">
      <text wrapMode="none" fg={c.dim}>prévia</text>
      {(["ok", "warn", "error", "info"] as const).map((kind) => {
        const line = result(kind);
        return (
          <text key={kind} wrapMode="none">
            <span fg={line.color}>{line.marker}</span>
            <span fg={c.text}>{` ${samples[kind]}`}</span>
          </text>
        );
      })}
      <text wrapMode="none"> </text>
      <text wrapMode="none">
        <span fg={c.accent} bg={c.selected}>{` ${g.active} chip `}</span>
        <span fg={c.text}>{"  "}</span>
        <span fg={c.accent}>{full}</span>
        <span fg={c.dim}>{empty}</span>
        <span fg={c.dim}>{" 60%"}</span>
      </text>
      <box height={3} {...box(c.accent)} paddingX={1}>
        <text fg={c.text} wrapMode="none">foco</text>
      </box>
    </box>
  );
}

/**
 * The editor of the custom theme: "começar de" copies a built-in theme, and each token is a hex that `enter` edits.
 * It replaces the sections while it is open; `esc` closes it. Every change applies live and is saved by the theme provider.
 */
export function ThemeEditor({ onClose }: { onClose: () => void }) {
  const { c, g, axes, set } = useTheme();
  const { cols } = useLayout();
  const nudge = useNudge();
  const ids = [FROM, ...TOKEN_KEYS] as string[];
  const hex: HexTokens = hexTokensFor("custom", axes.custom)!;
  const [selected, setSelected] = useState<string>(FROM);
  const [from, setFrom] = useState("dark");
  const [edit, setEdit] = useState<Line | null>(null);
  const rows = useOver(); // the row under the mouse
  const parts = useOver(); // the value under the mouse: `<row>:val`
  const scroll = useRef<ScrollBoxRenderable>(null);
  useScreenScope(edit ? "sistemaedit" : "sistematema", 1);
  useEffect(() => void scroll.current?.scrollChildIntoView(`editor:${selected}`), [selected]);

  const applyEdit = () => {
    const value = normalizeHex(edit!.text);
    if (!value) return nudge("hex inválido: use #rrggbb");
    set({ custom: { ...axes.custom, [selected]: value } });
    setEdit(null);
  };
  const keysWhileEditing = (key: RoutedKey) => {
    if (matchKey(key, "esc")) return setEdit(null), true;
    if (matchKey(key, "enter")) return applyEdit(), true;
    const edited = editLine(edit!, key);
    return edited ? (setEdit({ text: edited.text, cursor: edited.cursor }), true) : undefined;
  };
  const move = (delta: number) => {
    const next = ids.indexOf(selected) + delta;
    if (!ids[next]) return nudge(delta < 0 ? "início da lista" : "fim da lista");
    setSelected(ids[next]!);
  };
  const enter = () => {
    if (selected === FROM) return set({ custom: { ...hexTokensFor(from as ThemeName)! } });
    setEdit(lineOf(hex[selected as TokenKey]));
  };

  useKeys((key) => {
    if (edit) return keysWhileEditing(key);
    if (key.name === "up" || key.name === "down") return move(key.name === "up" ? -1 : 1), true;
    if (matchKey(key, "esc")) return onClose(), true;
    if (selected === FROM && (key.name === "left" || key.name === "right")) return setFrom(cycle(SOURCES, from, key.name === "left" ? -1 : 1)), true;
    if (matchKey(key, "enter")) return enter(), true;
    if (key.name === "left" || key.name === "right") return nudge("enter edita o valor"), true;
  }, { paste: true });

  /** A click on a row selects it; a different row ends an open edit. */
  const pickRow = (id: string) => (edit && id !== selected && setEdit(null), setSelected(id));
  const listWidth = Math.max(MIN_LIST_W, cols - 2 - PREVIEW_W);
  const row = (id: string, label: string, body: React.ReactNode) => {
    const on = id === selected;
    const lit = !on && rows.over === id;
    const marker = on ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{lit ? `${g.query} ` : "  "}</span>;
    return (
      <box key={id} id={`editor:${id}`} flexShrink={0} flexDirection="row" backgroundColor={on ? c.selected : lit ? c.panel : undefined}
        onMouseOver={() => (rows.enter(id), !edit && setSelected(id))} onMouseOut={() => rows.leave(id)} onMouseDown={() => pickRow(id)}>
        <text wrapMode="none" flexShrink={0}>
          {marker}
          <span fg={on || lit ? c.text : c.dim}>{label.padEnd(LABEL_W)}</span>
        </text>
        {body}
      </box>
    );
  };
  const fromRow = row(FROM, "começar de", (
    <text wrapMode="none" fg={c.text} flexShrink={0}>{`${g.moreLeft} ${SOURCES.find(([value]) => value === from)![1]} ${g.moreRight}`}</text>
  ));
  const tokenRow = (key: TokenKey) => {
    const value = hex[key];
    const editing = edit !== null && key === selected;
    const ratio = TEXT_TOKENS.includes(key) ? contrast(value, hex.bg) : 21;
    const shown = editing ? normalizeHex(edit.text) : value;
    const valueKey = `${key}:val`;
    return row(key, key, (
      <>
        <box flexShrink={0} onMouseOver={() => parts.enter(valueKey)} onMouseOut={() => parts.leave(valueKey)} onMouseDown={() => (pickRow(key), !editing && setEdit(lineOf(value)))}>
          <text wrapMode="none">{editing ? <LineText line={edit} focused width={HEX_W} /> : <span fg={c.text}>{parts.over === valueKey ? <u>{value}</u> : value}</span>}</text>
        </box>
        <text wrapMode="none" flexShrink={0}>
          <span bg={shown ?? undefined}>{shown ? "   " : ""}</span>
          {!editing && ratio < 4.5 ? <span fg={c.warn}>{` ${g.warn} ${ratio.toFixed(1)}:1`}</span> : null}
        </text>
      </>
    ));
  };
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <text wrapMode="none" fg={c.dim} flexShrink={0}>{`  Sistema ${g.query} tema personalizado`}</text>
      <box flexGrow={1} minHeight={0} flexDirection="row">
        <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false} width={listWidth} flexShrink={0}>
          <box flexDirection="column" paddingX={1} flexShrink={0} width={listWidth - 1}>
            {fromRow}
            {TOKEN_KEYS.map(tokenRow)}
          </box>
        </scrollbox>
        <Preview />
      </box>
    </box>
  );
}
