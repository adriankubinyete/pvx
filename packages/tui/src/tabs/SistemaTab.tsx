import { useEffect, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { useKeys, type RoutedKey } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useOver } from "../hover.ts";
import { useNudge } from "../nudge.tsx";
import { wrap } from "../panelnav.ts";
import { useScreenScope } from "../router.tsx";
import { Panel } from "../sdk-ui/kit.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { hexTokensFor, normalizeHex, tokensFor, TOKEN_KEYS, type HexTokens, type ThemeName } from "../theme.ts";
import type { TuiState } from "@pvx/core";
import { useTabs } from "./context.ts";
import { PvxInfo, UpdateStatus, UPDATE_BUTTONS, useUpdateCheck, type UpdateButton } from "./SistemaPvx.tsx";
import { ChoiceCells, SETTING_LABEL_W, SettingRow, SwatchCells } from "./SistemaRows.tsx";
import { BESIDE_COLS, sampleWidth, ThemeSample } from "./ThemeSample.tsx";
import { FromControls, SOURCES, TokenControls } from "./ThemeTokenRows.tsx";
import { ACCENT_OPTIONS, choiceAxisOf, CHOICE_AXES, cycle, firstRowOf, isTokenRow, presetColor, rowIds, SECTION_TITLES, SECTIONS, sectionOfKey, sectionOfRow, tokenOfRow, tokenRowId, type RowId, type Section } from "./sistema.ts";

/** Columns the frame and the page padding take from the terminal width. */
const FRAME_W = 4;
/** Columns of a section's gutter (the `▌` and its padding). */
const GUTTER_W = 2;
/** Cells of the marker column of a row. */
const CURSOR_W = 2;
const TASKS_NOTE = "tarefas em segundo plano de todos os módulos";
const GAP_TO_SAMPLE_W = 2;

type Axis = "theme" | "symbols" | "border" | "result" | "accent";

/** Sistema: three sections in one page, the cursor going through their rows. `1`, `2` and `3` jump between the sections. With the custom theme, Aparência holds its editor in place of the preset options. */
export function SistemaTab({ store, registry, version }: { store: SessionApi; registry: Registry; version: string }) {
  const { c, axes, set } = useTheme();
  const { cols } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const focused = tabs?.focused ?? true;
  const customTheme = axes.theme === "custom";
  const ids = rowIds(customTheme);
  const [wanted, setWanted] = useState<RowId>(ids[0]!);
  const row: RowId = ids.includes(wanted) ? wanted : "theme"; // the rows change with the theme: the cursor stays on `tema`
  const [button, setButton] = useState<UpdateButton>("verify");
  const [swatch, setSwatch] = useState<string | undefined>(undefined); // the accent swatch the keyboard is on, until enter chooses it
  const [from, setFrom] = useState("dark");
  const [edit, setEdit] = useState<Line | null>(null); // the hex being typed
  const [hover, setHover] = useState<Partial<TuiState>>({}); // the option the mouse is over, previewed
  const state = useUpdateCheck(store, registry, version);
  const rows = useOver(); // the row under the mouse
  const parts = useOver(); // the color value under the mouse
  const scroll = useRef<ScrollBoxRenderable>(null);
  useScreenScope(edit ? "sistemaedit" : "sistema", 1);
  useEffect(() => void scroll.current?.scrollChildIntoView(`sistema:${row}`), [row]);

  const width = cols - FRAME_W;
  const hex: HexTokens = hexTokensFor("custom", axes.custom)!;
  const setRow = (id: RowId) => (setWanted(id), edit && id !== row && setEdit(null));
  const press = (which: UpdateButton) => (setButton(which), which === "update" ? state.update() : void state.verify());
  const toggleTasks = () => set({ showTasksTab: !axes.showTasksTab });
  const choose = (axis: Axis, value: string) => set({ [axis]: value });
  const chooseAccent = (value: string) => (setSwatch(undefined), choose("accent", value));
  const applyEdit = () => {
    const value = normalizeHex(edit!.text);
    if (!value) return nudge("hex inválido: use #rrggbb");
    if (isTokenRow(row)) set({ custom: { ...axes.custom, [tokenOfRow(row)]: value } });
    setEdit(null);
  };
  /** `delta` steps the value of a row; the rows with nothing to step ignore it. */
  const step = (delta: number) => {
    const axis = choiceAxisOf(row);
    if (axis) return choose(axis.id, cycle(axis.options, axes[axis.id], delta));
    if (row === "accent") return setSwatch(cycle(ACCENT_OPTIONS, swatch ?? axes.accent, delta));
    if (row === "from") return setFrom(cycle(SOURCES, from, delta));
    if (row === "update") return setButton(UPDATE_BUTTONS[wrap(UPDATE_BUTTONS.indexOf(button), delta, UPDATE_BUTTONS.length)]!);
    nudge(isTokenRow(row) ? "enter edita o valor" : "nada para escolher");
  };
  const activate = () => {
    if (row === "update") return press(button);
    if (row === "tasks") return toggleTasks();
    if (row === "accent") return chooseAccent(swatch ?? axes.accent);
    if (row === "from") return set({ custom: { ...hexTokensFor(from as ThemeName)! } });
    if (isTokenRow(row)) return setEdit(lineOf(hex[tokenOfRow(row)]));
    step(1);
  };
  const move = (delta: number) => {
    const index = ids.indexOf(row) + delta;
    if (index < 0) return tabs?.focusBar();
    setRow(ids[index % ids.length]!); // ↓ on the last row wraps to the first
  };
  const keysWhileEditing = (key: RoutedKey) => {
    if (matchKey(key, "esc")) return setEdit(null), true;
    if (matchKey(key, "enter")) return applyEdit(), true;
    const edited = editLine(edit!, key);
    return edited ? (setEdit({ text: edited.text, cursor: edited.cursor }), true) : undefined;
  };
  const onKey = (key: RoutedKey) => {
    const section = sectionOfKey(key.sequence);
    if (section && !key.ctrl) return setRow(firstRowOf(section)), true;
    if (key.name === "up") return move(-1), true;
    if (key.name === "down") return move(1), true;
    if (key.name === "left" || key.name === "right") return step(key.name === "left" ? -1 : 1), true;
    if (matchKey(key, "enter") || (key.sequence === " " && row === "tasks")) return activate(), true;
    if (matchKey(key, "u")) return state.update(), true;
    if (matchKey(key, "esc")) return tabs?.focusBar(), true;
  };
  useKeys((key) => (!focused ? undefined : edit ? keysWhileEditing(key) : onKey(key)), { paste: true });

  const pick = (id: string) => setRow(id as RowId);
  const hoverRow = (id: string) => (rows.enter(id), focused && !edit && pick(id));
  const settingRow = (id: RowId, label: string, controls: React.ReactNode) => (
    <SettingRow key={id} id={id} label={label} on={focused && row === id} current={row === id} lit={rows.over === id && row !== id} onOver={hoverRow} onOut={rows.leave} onPress={pick}>
      {controls}
    </SettingRow>
  );
  const sectionPanel = (section: Section, body: React.ReactNode) => (
    <Panel key={section} title={`[${SECTIONS.indexOf(section) + 1}] ${SECTION_TITLES[section]}`} tone={focused && sectionOfRow(row) === section ? "accent" : undefined} onPress={() => setRow(firstRowOf(section))}>
      {body}
    </Panel>
  );

  const beside = cols >= BESIDE_COLS;
  const innerWidth = width - GUTTER_W;
  const optionsWidth = beside ? innerWidth - sampleWidth(innerWidth) - GAP_TO_SAMPLE_W : innerWidth;
  const choiceRoom = optionsWidth - CURSOR_W - SETTING_LABEL_W;
  const swatches = { tema: tokensFor(axes.theme, axes.custom).accent, ...Object.fromEntries(ACCENT_OPTIONS.flatMap(([value]) => (presetColor(value) ? [[value, presetColor(value)!]] : []))) };

  const choiceRow = (axisId: "theme" | "symbols" | "border" | "result") => {
    const axis = CHOICE_AXES.find((candidate) => candidate.id === axisId)!;
    return settingRow(axis.id, axis.label, <ChoiceCells options={axis.options} value={axes[axis.id]} on={focused && row === axis.id} room={choiceRoom} onChoose={(value) => choose(axis.id, value)} onHover={(value) => setHover(value ? { [axis.id]: value } : {})} />);
  };
  const accentRow = settingRow("accent", "acento", (
    <SwatchCells options={ACCENT_OPTIONS} value={axes.accent} cursor={focused && row === "accent" ? swatch ?? axes.accent : undefined} colors={swatches} onChoose={chooseAccent} onHover={(value) => setHover(value ? { accent: value } : {})} />
  ));
  const tokenRow = (key: (typeof TOKEN_KEYS)[number]) => {
    const id = tokenRowId(key);
    const editing = row === id && edit !== null;
    return settingRow(id, key, (
      <TokenControls token={key} hex={hex} edit={editing ? edit : null} hot={parts.over === key} onOverValue={() => parts.enter(key)} onOutValue={() => parts.leave(key)} onPressValue={() => (setRow(id), !editing && setEdit(lineOf(hex[key])))} />
    ));
  };
  const fromRow = settingRow("from", "começar de", <FromControls from={from} />);
  const options = customTheme ? [fromRow, ...TOKEN_KEYS.map(tokenRow)] : [accentRow, choiceRow("symbols"), choiceRow("border"), choiceRow("result")];

  // What the sample shows: the option the mouse is over, the swatch the keyboard is on, or the hex being typed.
  const typedPatch = (): Partial<TuiState> => {
    const typed = edit && isTokenRow(row) ? normalizeHex(edit.text) : null;
    return typed && isTokenRow(row) ? { custom: { ...axes.custom, [tokenOfRow(row)]: typed } } : {};
  };
  const keyboardPatch: Partial<TuiState> = row === "accent" && swatch ? { accent: swatch } : {};
  const patch = { ...keyboardPatch, ...typedPatch(), ...hover };

  const appearanceRows = <>{choiceRow("theme")}{options}</>;
  const appearance = beside ? (
    <box flexDirection="row" columnGap={GAP_TO_SAMPLE_W} flexShrink={0}>
      <box flexDirection="column" width={optionsWidth} flexShrink={0}>{appearanceRows}</box>
      <box flexGrow={1}><ThemeSample patch={patch} /></box>
    </box>
  ) : (
    <>
      {appearanceRows}
      <ThemeSample patch={patch} />
    </>
  );
  const updateRow = settingRow("update", "atualização", <UpdateStatus state={state} current={focused && row === "update" ? button : undefined} onPress={(which) => (setRow("update"), press(which))} />);
  const advanced = settingRow("tasks", "aba Tarefas", (
    <box flexDirection="row" flexShrink={0} onMouseDown={toggleTasks}>
      <text wrapMode="none" flexShrink={0}>
        <span fg={axes.showTasksTab ? c.accent : c.dim}>{axes.showTasksTab ? "[x]" : "[ ]"}</span>
        <span fg={c.text}>{" mostrar"}</span>
        <span fg={c.dim}>{`   ${TASKS_NOTE}`}</span>
      </text>
    </box>
  ));
  return (
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
      <box flexDirection="column" paddingX={1} flexShrink={0}>
        {sectionPanel("pvx", <PvxInfo facts={state.facts} width={innerWidth} update={updateRow} />)}
        {sectionPanel("aparencia", appearance)}
        {sectionPanel("avancado", advanced)}
      </box>
    </scrollbox>
  );
}
