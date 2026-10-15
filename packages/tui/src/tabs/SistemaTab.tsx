import { useEffect, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys, type RoutedKey } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useOver } from "../hover.ts";
import { useNudge } from "../nudge.tsx";
import { wrap } from "../panelnav.ts";
import { useScreenScope } from "../router.tsx";
import { Button } from "../sdk-ui/flow.tsx";
import { Panel } from "../sdk-ui/kit.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { tokensFor } from "../theme.ts";
import { useTabs } from "./context.ts";
import { ThemeEditor } from "./SistemaEditor.tsx";
import { PvxInfo, UpdateStatus, UPDATE_BUTTONS, useUpdateCheck, type UpdateButton } from "./SistemaPvx.tsx";
import { ChoiceCells, SETTING_LABEL_W, SettingRow, SwatchCells } from "./SistemaRows.tsx";
import { ACCENT_OPTIONS, choiceAxisOf, CHOICE_AXES, cycle, firstRowOf, presetColor, ROW_IDS, SECTION_OF_ROW, SECTION_TITLES, SECTIONS, sectionOfKey, type RowId, type Section } from "./sistema.ts";

/** Columns the frame and the page padding take from the terminal width. */
const FRAME_W = 4;
/** Columns of a section's gutter (the `▌` and its padding). */
const GUTTER_W = 2;
/** Cells of the marker column of a row. */
const CURSOR_W = 2;
const TASKS_NOTE = "tarefas em segundo plano de todos os módulos";

/** Sistema: three sections in one page, the cursor going through their rows. `1`, `2` and `3` jump between the sections. */
export function SistemaTab({ store, registry, version }: { store: SessionApi; registry: Registry; version: string }) {
  const { c, axes, set } = useTheme();
  const { cols } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const focused = tabs?.focused ?? true;
  const [row, setRow] = useState<RowId>(ROW_IDS[0]);
  const [button, setButton] = useState<UpdateButton>("verify");
  const [editing, setEditing] = useState(false);
  const state = useUpdateCheck(store, registry, version);
  const rows = useOver(); // the row under the mouse
  const scroll = useRef<ScrollBoxRenderable>(null);
  useScreenScope("sistema", 1);
  useEffect(() => void scroll.current?.scrollChildIntoView(`sistema:${row}`), [row]);

  const width = cols - FRAME_W;
  const press = (which: UpdateButton) => (setButton(which), which === "update" ? state.update() : void state.verify());
  const openEditor = () => (set({ theme: "custom" }), setEditing(true)); // editing a theme means being on it: the preview is the page itself
  const toggleTasks = () => set({ showTasksTab: !axes.showTasksTab });
  const choose = (axis: "theme" | "symbols" | "border" | "result" | "accent", value: string) => set({ [axis]: value });
  /** `delta` steps the value of a row; the rows with nothing to step ignore it. */
  const step = (delta: number) => {
    const axis = choiceAxisOf(row);
    if (axis) return choose(axis.id, cycle(axis.options, axes[axis.id], delta));
    if (row === "accent") return choose("accent", cycle(ACCENT_OPTIONS, axes.accent, delta));
    if (row === "update") return setButton(UPDATE_BUTTONS[wrap(UPDATE_BUTTONS.indexOf(button), delta, UPDATE_BUTTONS.length)]!);
    nudge("nada para escolher");
  };
  const activate = () => {
    if (row === "update") return press(button);
    if (row === "edit") return openEditor();
    if (row === "tasks") return toggleTasks();
    step(1);
  };
  const move = (delta: number) => {
    const index = ROW_IDS.indexOf(row) + delta;
    if (index < 0) return tabs?.focusBar();
    setRow(ROW_IDS[index % ROW_IDS.length]!); // ↓ on the last row wraps to the first
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
  useKeys((key) => (focused && !editing ? onKey(key) : undefined));

  if (editing) return <ThemeEditor onClose={() => setEditing(false)} />;

  const pick = (id: string) => setRow(id as RowId);
  const hover = (id: string) => (rows.enter(id), focused && pick(id));
  const settingRow = (id: RowId, label: string, controls: React.ReactNode) => (
    <SettingRow key={id} id={id} label={label} on={focused && row === id} current={row === id} lit={rows.over === id && row !== id} onOver={hover} onOut={rows.leave} onPress={pick}>
      {controls}
    </SettingRow>
  );
  const sectionPanel = (section: Section, body: React.ReactNode) => (
    <Panel key={section} title={`[${SECTIONS.indexOf(section) + 1}] ${SECTION_TITLES[section]}`} tone={focused && SECTION_OF_ROW[row] === section ? "accent" : undefined} onPress={() => setRow(firstRowOf(section))}>
      {body}
    </Panel>
  );

  const themeAccent = tokensFor(axes.theme, axes.custom).accent;
  const swatches = { tema: themeAccent, ...Object.fromEntries(ACCENT_OPTIONS.flatMap(([value]) => presetColor(value) ? [[value, presetColor(value)!]] : [])) };
  const infoWidth = width - GUTTER_W;
  const choiceRoom = infoWidth - CURSOR_W - SETTING_LABEL_W;
  const updateRow = settingRow("update", "atualização", (
    <UpdateStatus state={state} current={focused && row === "update" ? button : undefined} onPress={(which) => (setRow("update"), press(which))} />
  ));
  const appearance = (
    <>
      {CHOICE_AXES.slice(0, 1).map((axis) => settingRow(axis.id, axis.label, <ChoiceCells options={axis.options} value={axes[axis.id]} on={focused && row === axis.id} room={choiceRoom} onChoose={(value) => choose(axis.id, value)} />))}
      {settingRow("accent", "acento", <SwatchCells options={ACCENT_OPTIONS} value={axes.accent} colors={swatches} onChoose={(value) => choose("accent", value)} />)}
      {CHOICE_AXES.slice(1).map((axis) => settingRow(axis.id, axis.label, <ChoiceCells options={axis.options} value={axes[axis.id]} on={focused && row === axis.id} room={choiceRoom} onChoose={(value) => choose(axis.id, value)} />))}
      {settingRow("edit", "", <Button label="editar tema personalizado" focused={focused && row === "edit"} onPress={openEditor} />)}
    </>
  );
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
        {sectionPanel("pvx", <PvxInfo facts={state.facts} width={infoWidth} update={updateRow} />)}
        {sectionPanel("aparencia", appearance)}
        {sectionPanel("avancado", advanced)}
      </box>
    </scrollbox>
  );
}
