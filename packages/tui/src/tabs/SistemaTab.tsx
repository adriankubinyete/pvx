import { useState } from "react";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useNudge } from "../nudge.tsx";
import { useScreenScope } from "../router.tsx";
import { useTheme } from "../theme-context.tsx";
import { contrast, hexTokensFor, normalizeHex, TEXT_TOKENS, TOKEN_KEYS, type HexTokens, type TokenKey } from "../theme.ts";
import { useLayout } from "../layout.ts";
import { useOver } from "../hover.ts";
import { useTabs } from "./context.ts";
import { meter } from "./home.ts";
import { SECTIONS, SECTION_LABELS, sectionOfKey, type Section } from "./sistema.ts";
import { PvxSection } from "./SistemaPvx.tsx";
import type { SessionApi } from "../session/store.ts";
import type { Registry } from "@pvx/core";

type Opts = readonly (readonly [string, string])[];
/** The axes of the Aparência section: state key, label and the values with their display names. */
const AXES: readonly { id: "theme" | "accent" | "symbols" | "border" | "result"; label: string; opts: Opts }[] = [
  { id: "theme", label: "tema", opts: [["dark", "Escuro"], ["light", "Claro"], ["contrast", "Alto contraste"], ["terminal", "Terminal"], ["custom", "Personalizado"]] },
  { id: "accent", label: "cor de destaque", opts: [["tema", "do tema"], ["menta", "menta"], ["azul", "azul"], ["ambar", "âmbar"], ["roxo", "roxo"]] },
  { id: "symbols", label: "símbolos", opts: [["unicode", "unicode"], ["ascii", "ascii"]] },
  { id: "border", label: "moldura", opts: [["rounded", "arredondada"], ["single", "simples"], ["none", "nenhuma"]] },
  { id: "result", label: "linha de resultado", opts: [["bracket", "colchetes"], ["glyph", "símbolo"], ["text", "texto"]] },
];
/** Themes with known hex values: the ones "Começar de" can copy. */
const SOURCES: Opts = [["dark", "Escuro"], ["light", "Claro"], ["contrast", "Alto contraste"]];
const FROM = "from";
const LABEL_W = 19;
const PREVIEW_W = 34;

const at = (opts: Opts, v: string) => Math.max(0, opts.findIndex(([k]) => k === v));
const cycle = (opts: Opts, v: string, d: number) => opts[(at(opts, v) + d + opts.length) % opts.length]![0];

function Preview() {
  const { c, g, box, result } = useTheme();
  const [full, empty] = meter(60, 10, g);
  return (
    <box width={PREVIEW_W} flexShrink={0} flexDirection="column" paddingX={1} overflow="hidden" {...box()} title={`${g.query} prévia`}>
      {(["ok", "warn", "error", "info"] as const).map((k, i) => {
        const r = result(k);
        return (
          <text key={k} wrapMode="none">
            <span fg={r.color}>{r.marker}</span>
            <span fg={c.text}>{` ${["operação concluída", "revise isto", "falhou", "para saber mais"][i]}`}</span>
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

/** The Aparência section. Every change applies live (the theme provider repaints) and is saved by the debounced writer. */
function AparenciaSection({ onSection }: { onSection: (section: Section) => void }) {
  const { c, g, box, axes, set } = useTheme();
  const { cols } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const focused = tabs?.focused ?? true;
  const custom = axes.theme === "custom";
  const hex: HexTokens = hexTokensFor("custom", axes.custom)!;
  const ids = [...AXES.map((a) => a.id as string), ...(custom ? [FROM, ...TOKEN_KEYS] : [])];
  const [sel, setSel] = useState<string>(ids[0]!);
  const [from, setFrom] = useState("dark");
  const [edit, setEdit] = useState<Line | null>(null);
  const rows = useOver(); // the row under the mouse
  const part = useOver(); // the arrow or value under the mouse: `<row>:-1`, `<row>:1`, `<row>:val`
  useScreenScope(edit ? "sistemaedit" : "sistema", 1);
  const cur = ids.includes(sel) ? sel : ids[0]!; // "personalizado" can go away under the cursor
  const axis = AXES.find((a) => a.id === cur);

  const change = (d: number) => {
    if (axis) return set({ [axis.id]: cycle(axis.opts, axes[axis.id], d) });
    if (cur === FROM) return setFrom(cycle(SOURCES, from, d));
    nudge("enter edita o valor");
  };

  useKeys((k) => {
    if (!focused) return;
    if (edit) {
      if (matchKey(k, "esc")) return setEdit(null), true;
      if (matchKey(k, "enter")) {
        const v = normalizeHex(edit.text);
        if (!v) return nudge("hex inválido: use #rrggbb"), true;
        set({ custom: { ...axes.custom, [cur]: v } });
        return setEdit(null), true;
      }
      const e = editLine(edit, k);
      return e ? (setEdit({ text: e.text, cursor: e.cursor }), true) : undefined;
    }
    const section = sectionOfKey(k.sequence);
    if (section) return onSection(section), true;
    if (k.name === "up" || k.name === "down") {
      const i = ids.indexOf(cur) + (k.name === "up" ? -1 : 1);
      if (i < 0) return tabs?.focusBar(), true;
      return ids[i] ? setSel(ids[i]!) : nudge("fim da lista"), true;
    }
    if (matchKey(k, "esc")) return tabs?.focusBar(), true;
    if (k.name === "left" || k.name === "right") return change(k.name === "left" ? -1 : 1), true;
    if (matchKey(k, "enter")) {
      if (axis) return change(1), true;
      if (cur === FROM) return set({ custom: { ...hexTokensFor(from as "dark")! } }), true;
      return setEdit(lineOf(hex[cur as TokenKey])), true;
    }
  });

  /** A click on a row or one of its buttons selects it; a different row ends an open edit. */
  const pickRow = (id: string) => (edit && id !== cur && setEdit(null), setSel(id));
  const listW = Math.max(40, cols - 2 - PREVIEW_W);
  const valueW = listW - 4 - 2 - LABEL_W;
  /**
   * A row. Hover always reacts: with the list active it moves the selection, otherwise it only tints (panel background and a dim ›).
   * A click selects the row (the tab container takes the focus). `pick` makes it a `‹ value ›` row whose arrows step the value
   * like ←/→; `tail` is the clickable value of a token row (a click edits it).
   */
  const row = (id: string, label: string, pick?: { name: string; step: (d: number) => void }, tail?: React.ReactNode) => {
    const on = focused && id === cur;
    const lit = !on && rows.over === id; // the mouse is on a row the list does not have selected: tint only
    const mark = on ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{lit || id === cur ? `${g.query} ` : "  "}</span>; // inactive selection: a muted ›
    const arrow = (d: number, glyph: string) => {
      const k = `${id}:${d}`;
      return (
        <box flexShrink={0} onMouseOver={() => part.enter(k)} onMouseOut={() => part.leave(k)} onMouseDown={() => (pickRow(id), pick!.step(d))}>
          <text wrapMode="none" fg={c.text}>{part.over === k ? <b><u>{glyph}</u></b> : glyph}</text>
        </box>
      );
    };
    return (
      <box key={id} flexShrink={0} flexDirection="row" backgroundColor={on ? c.selected : lit ? c.panel : undefined}
        onMouseOver={() => (rows.enter(id), !edit && focused && setSel(id))} onMouseOut={() => rows.leave(id)} onMouseDown={() => pickRow(id)}>
        <text wrapMode="none" flexShrink={0}>
          {mark}
          <span fg={on || lit || id === cur ? c.text : c.dim}>{label.padEnd(LABEL_W)}</span>
        </text>
        {pick ? (
          <>
            {arrow(-1, g.moreLeft)}
            <text wrapMode="none" fg={c.text} flexShrink={0}>{` ${pick.name.slice(0, valueW - 4)} `}</text>
            {arrow(1, g.moreRight)}
          </>
        ) : tail}
      </box>
    );
  };
  const token = (k: TokenKey) => {
    const h = hex[k];
    const editing = edit && k === cur;
    const ratio = TEXT_TOKENS.includes(k) ? contrast(h, hex.bg) : 21;
    const shown = editing ? normalizeHex(edit.text) : h;
    const vk = `${k}:val`;
    return row(k, k, undefined, (
      <>
        <box flexShrink={0} onMouseOver={() => part.enter(vk)} onMouseOut={() => part.leave(vk)} onMouseDown={() => (pickRow(k), !editing && setEdit(lineOf(h)))}>
          <text wrapMode="none">{editing ? <LineText line={edit} focused width={9} /> : <span fg={c.text}>{part.over === vk ? <u>{h}</u> : h}</span>}</text>
        </box>
        <text wrapMode="none" flexShrink={0}>
          <span bg={shown ?? undefined}>{shown ? "   " : ""}</span>
          {!editing && ratio < 4.5 ? <span fg={c.warn}>{` ${g.warn} ${ratio.toFixed(1)}:1`}</span> : null}
        </text>
      </>
    ));
  };
  return (
    <box flexGrow={1} minHeight={0} flexDirection="row">
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1} overflow="hidden" {...box(focused ? c.accent : undefined)} title={`${g.query} aparência${focused ? ` ${g.active}` : ""}`}>
        {AXES.map((a) => row(a.id, a.label, { name: a.opts[at(a.opts, axes[a.id])]![1], step: (d) => set({ [a.id]: cycle(a.opts, axes[a.id], d) }) }))}
        {custom ? row(FROM, "começar de", { name: SOURCES[at(SOURCES, from)]![1], step: (d) => setFrom(cycle(SOURCES, from, d)) }) : null}
        {custom ? TOKEN_KEYS.map(token) : null}
      </box>
      <Preview />
    </box>
  );
}

/** One entry of the section strip: `[1] aparência`. A click opens the section. */
function SectionLabel({ section, active, focused, onPress }: { section: Section; active: boolean; focused: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const over = useOver<Section>();
  const label = `[${SECTIONS.indexOf(section) + 1}] ${SECTION_LABELS[section]}`;
  const color = active && focused ? c.accent : active ? c.text : c.dim;
  const hovered = over.over === section;
  return (
    <box flexShrink={0} paddingRight={2} onMouseOver={() => over.enter(section)} onMouseOut={() => over.leave(section)} onMouseDown={onPress}>
      <text wrapMode="none" fg={color}>{active || hovered ? <b><u>{label}</u></b> : label}</text>
    </box>
  );
}

/** Sistema: Aparência (themes) and pvx (about, update, uninstall). `1` and `2` jump between the sections, like the numbered panels. */
export function SistemaTab({ store, registry, version }: { store: SessionApi; registry: Registry; version: string }) {
  const tabs = useTabs();
  const [section, setSection] = useState<Section>("aparencia");
  const focused = tabs?.focused ?? true;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>
        {SECTIONS.map((id) => (
          <SectionLabel key={id} section={id} active={id === section} focused={focused} onPress={() => setSection(id)} />
        ))}
      </box>
      {section === "aparencia" ? <AparenciaSection onSection={setSection} /> : null}
      {section === "pvx" ? <PvxSection store={store} registry={registry} version={version} onSection={setSection} /> : null}
    </box>
  );
}
