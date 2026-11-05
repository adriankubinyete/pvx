import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createMachineSampler, hostSession, type MachineSampler, type Registry } from "@pvx/core";
import type { HomeNote, SessionInfo } from "@pvx/sdk";
import { matchKey } from "../keymap.ts";
import { useOver } from "../hover.ts";
import { useKeys, type RoutedKey } from "../keys.tsx";
import { useNudge } from "../nudge.tsx";
import { panelStep, usePanelNav, wrap } from "../panelnav.ts";
import { useLayout } from "../layout.ts";
import { useRouter, useScreenScope } from "../router.tsx";
import { SessionModals } from "../session/Modals.tsx";
import { loadFavorites } from "../palette/favorites.ts";
import { usePages } from "../sdk-ui/host.tsx";
import { Frame, headerParts } from "../sdk-ui/kit.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { MachineBlock } from "./HomeMachine.tsx";
import { HomeRowView, rowColumns } from "./HomeRows.tsx";
import { NoteComposer, outcomeOfRun } from "./HomeNote.tsx";
import { activityRows, activitySummary, attentionRows, chipRows, memoryRows, NEW_NOTE_ROW_ID, NEW_NOTE_TEXT, noteRows, notesSummary, upToDateText, type HomeRow } from "./home-rows.ts";
import { slotItems, syncHost, type Att, type Chip } from "./home.ts";
import type { TabsNav } from "./Tabs.tsx";

/** Section ids, in the order they are drawn; `notas` exists only while there is something to show or a module to write notes. */
export type HomePanel = "atencao" | "notas" | "atividade";
const SECTION_TITLES: Record<HomePanel, string> = { atencao: "atenção", notas: "notas", atividade: "atividade" };

/** Which section has the cursor and the selected row of each; lives in `TabsNav` (the tab unmounts on a switch). */
export interface HomeNav {
  panel: HomePanel;
  /** On the rows of the section (the selection shows) instead of on the section as a whole. */
  inside: boolean;
  sel: Record<string, string>;
}
export const createHomeNav = (): HomeNav => ({ panel: "atencao", inside: false, sel: {} });

const SAMPLE_MS = 2000;
/** Columns the frame and the page padding take from the terminal width (two on each side). */
const FRAME_W = 4;
/** Columns a section's Frame takes inside the content width: two borders and two cells of padding. */
const GUTTER_W = 4;
/** Cells of `   + nova nota`. */
const NEW_NOTE_W = 14;
let shared: MachineSampler | undefined;

type RowsBySection = Record<HomePanel, HomeRow[]>;

/** Everything Início reads from the host: machine samples, the slots and the session. */
interface HomeData {
  rows: RowsBySection;
  sections: readonly HomePanel[];
  upToDate?: string;
}

export function HomeTab({ store, nav, registry, sampler, session = hostSession }: { store: SessionApi; nav: TabsNav; registry: Registry; sampler?: MachineSampler; session?: SessionInfo }) {
  const slots = registry.slots;
  const { c, g, axes, result } = useTheme();
  const hidden = useMemo(() => new Set(axes.hiddenWidgets), [axes.hiddenWidgets]);
  const { cols } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const panels = usePanelNav();
  const focused = tabs?.focused ?? true;
  const [composing, setComposing] = useState(false); // the `+ nova nota` form takes the place of the page
  useScreenScope(composing ? "form" : nav.home.inside ? "homein" : "home", 1); // inside a section the footer changes; the tab bar (rank 2) still outranks it
  const { history, blocks, pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const router = useRouter();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const machine = useMemo(() => sampler ?? (shared ??= createMachineSampler()), [sampler]);
  const [sample, setSample] = useState(() => machine.sample());
  const [now, setNow] = useState(Date.now);
  const [sessionIp] = useState(() => session.sshClient); // `who` may run on the first read: once, not on every render
  // The only timer: it exists while Início is mounted.
  useEffect(() => {
    const timer = setInterval(() => (setSample(machine.sample()), setNow(Date.now())), SAMPLE_MS);
    return () => clearInterval(timer);
  }, [machine]);
  // The slot hub's single scheduler runs while Início is mounted; its changes re-render here.
  const makeLogger = usePages()?.makeLogger;
  useEffect(() => {
    const off = slots.subscribe(bump);
    const stop = slots.start(makeLogger?.("core") ?? { debug() {}, info() {}, warn() {}, error() {} });
    return () => (off(), stop());
  }, [slots]);
  const favorites = useMemo(() => loadFavorites(), []);

  syncHost(slots, registry.warnings); // the load avisos go through the same slots the modules use

  // The notes come from the `home.notes` slot and go through the commands of the `addNote` and `removeNote` roles: Início names no module.
  const addNote = registry.roles.get("addNote")?.name;
  const removeNote = registry.roles.get("removeNote")?.name;
  const canCompose = addNote !== undefined && registry.commands.has(addNote);

  const attention = slotItems<Att>(slots, "home.attention", hidden);
  const notes = slotItems<HomeNote>(slots, "home.notes", hidden);
  const chips = slotItems<Chip>(slots, "home.chips", hidden);
  const notices = [...attentionRows(attention, slots.broken("home.attention", hidden)), ...chipRows(chips, slots.broken("home.chips", hidden)), ...memoryRows(sample.mem)];
  const rows: RowsBySection = {
    atencao: notices,
    notas: noteRows(notes, canCompose, removeNote),
    atividade: activityRows(history, blocks, favorites, now, g),
  };
  const sections: readonly HomePanel[] = rows.notas.length ? ["atencao", "notas", "atividade"] : ["atencao", "atividade"];
  const data: HomeData = {
    rows, sections,
    upToDate: upToDateText(slotItems<Att>(slots, "home.configured", hidden).length),
  };

  const section = sections.includes(nav.home.panel) ? nav.home.panel : sections[0]!; // the notes section can go away
  const current = (panel: HomePanel) => rows[panel].find((row) => row.id === nav.home.sel[panel]) ?? rows[panel][0];
  const select = (panel: HomePanel, id: string) => (nav.home.sel[panel] = id, nav.home.panel = panel, nav.home.inside = true, bump());
  const refresh = () => void slots.refresh();
  /** `enter` on a note: its command runs, and the session asks first (the command is destructive). */
  const removeNoteRow = async (row: HomeRow) => {
    if (!row.remove) return;
    const { exit } = await store.run(row.remove);
    void slots.refresh();
    const outcome = outcomeOfRun(store.blocks.at(-1), exit);
    if (outcome) nudge(outcome.text, outcome.tone);
  };
  const useCommand = (row?: HomeRow) => {
    if (!row?.use) return;
    nav.draft = row.use;
    tabs?.goto("comando");
  };
  const act = (panel: HomePanel, row?: HomeRow) => {
    if (!row) return;
    if (panel === "notas") return row.id === NEW_NOTE_ROW_ID ? setComposing(true) : void removeNoteRow(row);
    useCommand(row);
  };

  // A mouse down bubbles from the clicked row to its section: the row (which selects and goes inside) marks the hit so the section does not undo it.
  const rowHit = useRef(false);
  const pickRow = (panel: HomePanel) => (row: HomeRow) => {
    rowHit.current = true;
    select(panel, row.id);
    act(panel, row);
  };
  const pressSection = (panel: HomePanel) => () => {
    if (rowHit.current) return void (rowHit.current = false);
    nav.home.panel = panel;
    nav.home.inside = false;
    bump(); // the tab bar's own handler (it runs after this one) moves the keyboard in
  };
  // Hover: a row tints. Inside the active list the hover also moves the selection (repo convention); anywhere else the selection stays.
  const overRow = useOver();
  const rowKey = (panel: HomePanel, row: HomeRow) => `${panel}|${row.id}`;
  const hover = (panel: HomePanel) => ({
    hot: overRow.over?.startsWith(`${panel}|`) ? overRow.over.slice(panel.length + 1) : undefined,
    onOver: (row: HomeRow) => {
      overRow.enter(rowKey(panel, row));
      const active = focused && nav.home.panel === panel && nav.home.inside;
      if (active && nav.home.sel[panel] !== row.id) (nav.home.sel[panel] = row.id, bump());
    },
    onOut: (row: HomeRow) => overRow.leave(rowKey(panel, row)),
  });

  // Keep the cursor in view: the page scrolls when it is taller than the screen.
  const scroll = useRef<ScrollBoxRenderable>(null);
  const cursorId = nav.home.inside ? `home:${section}:${current(section)?.id}` : `home:${section}`;
  // The rows of a section that just opened are laid out on the next tick: scroll then.
  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollChildIntoView(cursorId), 0);
    return () => clearTimeout(timer);
  }, [cursorId, focused]);

  useKeys((key) => {
    if (!focused || composing) return;
    const step = stepOf(key, section, nav, panels, rows);
    if (step) return applyStep(step);
    return shortcut(key);
  });

  const applyStep = (step: NonNullable<ReturnType<typeof stepOf>>) => {
    if (step.bar) return tabs?.focusBar(), true;
    if (step.nudge) return nudge(step.nudge), true;
    if (step.move) {
      const list = rows[section];
      const index = list.findIndex((row) => row.id === current(section)?.id);
      const to = list[wrap(Math.max(index, 0), step.move, list.length)];
      return to && select(section, to.id), true;
    }
    if (step.act) return act(section, current(section)), true;
    nav.home.panel = step.panel as HomePanel;
    nav.home.inside = step.inside;
    return bump(), true;
  };
  const shortcut = (key: RoutedKey) => {
    const jump = sections[Number(key.sequence) - 1];
    if (jump && !key.ctrl) return nav.home.panel = jump, nav.home.inside = false, bump(), true;
    if (matchKey(key, "n") && canCompose) return setComposing(true), true;
    if (matchKey(key, "esc")) return tabs?.focusBar(), true; // one level up: the section, then the bar
    if (matchKey(key, "r")) return refresh(), true;
    if (key.sequence === "/") return tabs?.goto("comando"), true;
  };

  const width = cols - FRAME_W; // the whole terminal width
  const sectionRows = (panel: HomePanel) => {
    const active = focused && nav.home.panel === panel;
    const list = rows[panel];
    const columns = rowColumns(list, width - GUTTER_W, { c, result });
    return (
      <>
        {list.map((row) => (
          <HomeRowView key={row.id} row={row} idPrefix={`home:${panel}`} columns={columns} on={active && nav.home.inside && row.id === current(panel)?.id}
            lit={hover(panel).hot === row.id && row.id !== current(panel)?.id} onOver={hover(panel).onOver} onOut={hover(panel).onOut} onPick={pickRow(panel)} />
        ))}
      </>
    );
  };
  const sectionTitle = (panel: HomePanel) => `${sections.indexOf(panel) + 1} ${headerParts(SECTION_TITLES[panel], "").label}`;
  const sectionActive = (panel: HomePanel) => focused && nav.home.panel === panel;
  const frame = (panel: HomePanel, children: React.ReactNode, aside?: string) => (
    <box key={panel} id={`home:${panel}`} flexShrink={0}>
      <Frame wide panelRef={panels.ref(panel) as never} onPress={pressSection(panel)} title={sectionTitle(panel)} active={sectionActive(panel)} aside={aside}>
        {children}
      </Frame>
    </box>
  );

  const attentionBody = (
    <>
      {sectionRows("atencao")}
      {data.upToDate ? <UpToDate text={data.upToDate} /> : null}
    </>
  );

  /** Notas and Atividade are one line until enter opens them (and while they are open they list their rows). */
  const expanded = (panel: HomePanel) => nav.home.panel === panel && nav.home.inside;
  const openSection = (panel: HomePanel) => {
    rowHit.current = true;
    nav.home.panel = panel;
    nav.home.inside = rows[panel].length > 0;
    bump();
  };
  const summaryRoom = Math.max(10, width - GUTTER_W - (canCompose ? NEW_NOTE_W : 0));
  const summaries: Record<"notas" | "atividade", React.ReactNode> = {
    notas: (
      <text wrapMode="none" onMouseDown={() => openSection("notas")}>
        <span fg={c.dim}>{notesSummary(rows.notas, summaryRoom)}</span>
        {canCompose ? <span fg={c.accent}>{`   ${NEW_NOTE_TEXT}`}</span> : null}
      </text>
    ),
    atividade: <text wrapMode="none" fg={c.dim} onMouseDown={() => openSection("atividade")}>{activitySummary(rows.atividade, summaryRoom)}</text>,
  };
  const noteCount = rows.notas.filter((row) => !row.action).length;
  const asides: Partial<Record<HomePanel, string>> = { notas: String(noteCount) };

  if (composing) return <NoteComposer store={store} registry={registry} line={addNote!} onClose={() => setComposing(false)} onSaved={() => void slots.refresh()} />;
  return (
    <>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
        <box flexDirection="column" paddingX={1} flexShrink={0}>
          <MachineBlock machine={sample} product={slots.read("home.product", hidden) as string | undefined} sessionIp={sessionIp} width={width} />
          {sections.map((panel) => {
            if (panel === "atencao") return frame(panel, attentionBody, asides[panel]);
            if (!expanded(panel)) return frame(panel, summaries[panel], asides[panel]);
            return frame(panel, sectionRows(panel), asides[panel]);
          })}
        </box>
      </scrollbox>
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </>
  );
}

function UpToDate({ text }: { text: string }) {
  const { c, result } = useTheme();
  const { marker } = result("ok");
  return (
    <text wrapMode="none" flexShrink={0}>
      <span>{"  "}</span>
      <span fg={c.ok}>{`${marker} `}</span>
      <span fg={c.dim}>{text}</span>
    </text>
  );
}

type ArrowKey = "left" | "right" | "up" | "down";

function arrowOf(key: RoutedKey): ArrowKey | undefined {
  if (key.name === "left" || key.name === "right" || key.name === "up" || key.name === "down") return key.name;
  return undefined;
}

/** The two-level focus rule (panelnav) for one key; undefined when the key is not an arrow, enter or esc. */
function stepOf(key: RoutedKey, section: HomePanel, nav: TabsNav, panels: ReturnType<typeof usePanelNav>, rows: RowsBySection) {
  const name = arrowOf(key) ?? (matchKey(key, "enter") ? "enter" : matchKey(key, "esc") ? "esc" : undefined);
  if (!name) return undefined;
  return panelStep({ panel: section, inside: nav.home.inside }, name, (from, dir) => panels.pick(from, dir), (panel) => rows[panel as HomePanel].length);
}
