import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createMachineSampler, hostSession, pageWithRole, type MachineSampler, type Registry } from "@pvx/core";
import type { SessionInfo } from "@pvx/sdk";
import { matchKey } from "../keymap.ts";
import { useOver } from "../hover.ts";
import { useKeys, type RoutedKey } from "../keys.tsx";
import { useNudge } from "../nudge.tsx";
import { panelStep, usePanelNav, wrap } from "../panelnav.ts";
import { useLayout } from "../layout.ts";
import { useScreenScope } from "../router.tsx";
import { loadFavorites } from "../palette/favorites.ts";
import { Loading } from "../sdk-ui/flow.tsx";
import { usePages } from "../sdk-ui/host.tsx";
import { Panel } from "../sdk-ui/kit.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { conformityOf, conformityView } from "./conformity.ts";
import { MachineBlock } from "./HomeMachine.tsx";
import { ActionsLine, HomeRowView } from "./HomeRows.tsx";
import { actionButtons, ACTIONS_ROW_ID, activityRows, activitySummary, attentionRows, chipRows, ignoredTexts, memoryRows, NEW_NOTE_ROW_ID, NEW_NOTE_TEXT, noteRows, notesSummary, unverifiedRow, upToDateText, VERIFY_ROW_ID, type HomeAction, type HomeRow } from "./home-rows.ts";
import { parseConformity, slotItems, syncHost, type Att, type Chip } from "./home.ts";
import type { TabsNav } from "./Tabs.tsx";

/** Section ids, in the order they are drawn; `notas` exists only while there is something to show or a module to write notes. */
export type HomePanel = "conformidade" | "notas" | "atividade";
const SECTION_TITLES: Record<HomePanel, string> = { conformidade: "atenção", notas: "notas", atividade: "atividade" };

/** Which section has the cursor and the selected row of each; lives in `TabsNav` (the tab unmounts on a switch). */
export interface HomeNav {
  panel: HomePanel;
  /** On the rows of the section (the selection shows) instead of on the section as a whole. */
  inside: boolean;
  sel: Record<string, string>;
  /** The button of the actions row the cursor is on. */
  action: HomeAction;
}
export const createHomeNav = (): HomeNav => ({ panel: "conformidade", inside: false, sel: {}, action: "verify" });

const SAMPLE_MS = 2000;
/** Columns the frame and the page padding take from the terminal width (two on each side). */
const FRAME_W = 4;
/** Columns of a section's gutter (the `▌` and its padding). */
const GUTTER_W = 2;
/** Cells the label of a one-line section takes (`3 Atividade`) and the gap after it. */
const SUMMARY_LABEL_W = 14;
/** Cells of `   + nova nota`. */
const NEW_NOTE_W = 14;
let shared: MachineSampler | undefined;

type RowsBySection = Record<HomePanel, HomeRow[]>;

/** Everything Início reads from the host: machine samples, the conformity cache, the slots and the session. */
interface HomeData {
  rows: RowsBySection;
  sections: readonly HomePanel[];
  upToDate?: string;
  ignored: string[];
  done?: ReturnType<typeof parseConformity>;
  running: boolean;
  planSteps: number;
}

export function HomeTab({ store, nav, profile, registry, sampler, session = hostSession }: { store: SessionApi; nav: TabsNav; profile?: string | null; registry: Registry; sampler?: MachineSampler; session?: SessionInfo }) {
  const slots = registry.slots;
  const { c, g, axes } = useTheme();
  const hidden = useMemo(() => new Set(axes.hiddenWidgets), [axes.hiddenWidgets]);
  const { cols } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const panels = usePanelNav();
  const focused = tabs?.focused ?? true;
  useScreenScope(nav.home.inside ? "homein" : "home", 1); // inside a section the footer changes; the tab bar (rank 2) still outranks it
  const { history, blocks } = useSyncExternalStore(store.subscribe, store.getSnapshot);
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

  const conf = conformityOf(store); // the cache module pages read too
  const snap = useSyncExternalStore(conf.subscribe, conf.getSnapshot);
  const done = snap.conformidade ? parseConformity(snap.conformidade) : undefined;
  syncHost(slots, done, registry.warnings); // the profile's items and the load avisos go through the same slots the modules use

  // `n` on Início opens the composer of whichever module declared the roles: the page with role `notes` and the `compose` query.
  const notesPage = pageWithRole(registry, "notes");
  const compose = registry.roles.get("compose")?.name;
  const canCompose = Boolean(notesPage && compose);
  const planPage = pageWithRole(registry, "plan");
  const planSteps = conformityView(snap).plan.steps.length;
  const buttons = actionButtons(planSteps, Boolean(planPage), Boolean(snap.conformidade));

  const attention = slotItems<Att>(slots, "home.attention", hidden);
  const notes = slotItems<string>(slots, "home.notes", hidden);
  const checked = Boolean(snap.conformidade);
  const chips = slotItems<Chip>(slots, "home.chips", hidden);
  const notices = [...attentionRows(attention, slots.broken("home.attention", hidden)), ...chipRows(chips, slots.broken("home.chips", hidden)), ...memoryRows(sample.mem), ...(checked || snap.running ? [] : [unverifiedRow()])];
  const rows: RowsBySection = {
    conformidade: [...notices, ...(checked ? [{ id: ACTIONS_ROW_ID, text: "" }] : [])],
    notas: noteRows(notes, canCompose),
    atividade: activityRows(history, blocks, favorites, now, g),
  };
  const sections: readonly HomePanel[] = rows.notas.length ? ["conformidade", "notas", "atividade"] : ["conformidade", "atividade"];
  const data: HomeData = {
    rows, sections, done, planSteps, running: snap.running,
    upToDate: upToDateText(slotItems<Att>(slots, "home.configured", hidden).length),
    ignored: ignoredTexts(done),
  };

  const section = sections.includes(nav.home.panel) ? nav.home.panel : sections[0]!; // the notes section can go away
  const current = (panel: HomePanel) => rows[panel].find((row) => row.id === nav.home.sel[panel]) ?? rows[panel][0];
  const select = (panel: HomePanel, id: string) => (nav.home.sel[panel] = id, nav.home.panel = panel, nav.home.inside = true, bump());
  const refresh = () => (conf.refresh(), void slots.refresh());
  const goNotes = () => notesPage && void store.run(`#${notesPage.key}`); // a pushed page, not a tab
  const goPlan = () => planPage && void store.run(`#${planPage.key}`);
  const useCommand = (row?: HomeRow) => {
    if (!row?.use) return;
    nav.draft = row.use;
    tabs?.goto("comando");
  };
  const press = (action: HomeAction) => {
    nav.home.action = action;
    if (action === "plan") goPlan();
    else refresh();
  };
  const act = (panel: HomePanel, row?: HomeRow) => {
    if (!row) return;
    if (row.id === ACTIONS_ROW_ID) return press(nav.home.action);
    if (row.id === VERIFY_ROW_ID) return refresh();
    if (panel === "notas") return row.id === NEW_NOTE_ROW_ID ? (void registry.query(compose!), goNotes()) : goNotes();
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
    if (!focused) return;
    const direction = arrowOf(key);
    if (direction && onActionsRow(section, nav, current(section)) && switchAction(direction, nav, buttons, bump)) return true;
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
    if (matchKey(key, "n") && canCompose) return void registry.query(compose!), goNotes(), true;
    if (matchKey(key, "esc")) return tabs?.focusBar(), true; // one level up: the section, then the bar
    if (matchKey(key, "p") && planPage && planSteps > 0) return goPlan(), true;
    if (matchKey(key, "r")) return refresh(), true;
    if (key.sequence === "/") return tabs?.goto("comando"), true;
  };

  const width = cols - FRAME_W;
  const sectionRows = (panel: HomePanel) => {
    const active = focused && nav.home.panel === panel;
    const list = rows[panel].filter((row) => row.id !== ACTIONS_ROW_ID);
    return (
      <>
        {list.map((row) => (
          <HomeRowView key={row.id} row={row} idPrefix={`home:${panel}`} width={width - GUTTER_W} on={active && nav.home.inside && row.id === current(panel)?.id}
            lit={hover(panel).hot === row.id && row.id !== current(panel)?.id} onOver={hover(panel).onOver} onOut={hover(panel).onOut} onPick={pickRow(panel)} />
        ))}
      </>
    );
  };
  const sectionTitle = (panel: HomePanel) => `[${sections.indexOf(panel) + 1}] ${SECTION_TITLES[panel]}`;
  const sectionTone = (panel: HomePanel) => (focused && nav.home.panel === panel ? ("accent" as const) : undefined);
  const frame = (panel: HomePanel, children: React.ReactNode, aside?: string) => (
    <box key={panel} id={`home:${panel}`} flexShrink={0}>
      <Panel panelRef={panels.ref(panel) as never} onPress={pressSection(panel)} title={sectionTitle(panel)} tone={sectionTone(panel)} aside={aside}>
        {children}
      </Panel>
    </box>
  );

  const attentionBody = (
    <>
      {data.running ? <Loading label="verificando a conformidade…" /> : null}
      {!data.running && done?.message ? <text fg={c.dim} flexShrink={0} wrapMode="none">{`  ${done.message}`}</text> : null}
      {!data.running && !done?.message ? sectionRows("conformidade") : null}
      {!data.running && done && !done.message && data.upToDate ? <UpToDate text={data.upToDate} /> : null}
      {!data.running && !done?.message ? data.ignored.map((text) => <text key={text} fg={c.dim} flexShrink={0} wrapMode="none">{`    ${g.inactive} ${text}`}</text>) : null}
      {checked ? <ActionsLine buttons={buttons} current={focused && nav.home.panel === "conformidade" && nav.home.inside && current("conformidade")?.id === ACTIONS_ROW_ID ? nav.home.action : undefined} onPress={(action) => { rowHit.current = true; select("conformidade", ACTIONS_ROW_ID); press(action); }} /> : null}
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
  const summaryRoom = Math.max(10, width - GUTTER_W - SUMMARY_LABEL_W - (canCompose ? NEW_NOTE_W : 0));
  const summaries: Record<"notas" | "atividade", React.ReactNode> = {
    notas: (
      <text wrapMode="none" onMouseDown={() => openSection("notas")}>
        <span fg={c.dim}>{notesSummary(rows.notas, summaryRoom)}</span>
        {canCompose ? <span fg={c.accent}>{`   ${NEW_NOTE_TEXT}`}</span> : null}
      </text>
    ),
    atividade: <text wrapMode="none" fg={c.dim} onMouseDown={() => openSection("atividade")}>{activitySummary(rows.atividade, summaryRoom)}</text>,
  };
  const oneLine = (panel: "notas" | "atividade") => {
    const above = sections[sections.indexOf(panel) - 1];
    const tight = panel === "atividade" && above === "notas" && !expanded("notas");
    return (
      <box key={panel} id={`home:${panel}`} flexShrink={0}>
        <Panel panelRef={panels.ref(panel) as never} onPress={pressSection(panel)} title={sectionTitle(panel)} tone={sectionTone(panel)} inline={summaries[panel]} tight={tight} />
      </box>
    );
  };

  return (
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
      <box flexDirection="column" paddingX={1} flexShrink={0}>
        <MachineBlock machine={sample} product={slots.read("home.product", hidden) as string | undefined} sessionIp={sessionIp} width={width} />
        {sections.map((panel) => {
          if (panel === "conformidade") return frame(panel, attentionBody, profile ? `perfil: ${profile}` : "sem perfil");
          if (!expanded(panel)) return oneLine(panel);
          return frame(panel, sectionRows(panel));
        })}
      </box>
    </scrollbox>
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

function onActionsRow(section: HomePanel, nav: TabsNav, row?: HomeRow): boolean {
  return section === "conformidade" && nav.home.inside && row?.id === ACTIONS_ROW_ID;
}

/** `←` and `→` on the actions row choose the button; they never leave the row. */
function switchAction(direction: ArrowKey, nav: TabsNav, buttons: { action: HomeAction }[], redraw: () => void): boolean {
  if (direction !== "left" && direction !== "right") return false;
  const index = Math.max(0, buttons.findIndex((button) => button.action === nav.home.action));
  nav.home.action = buttons[wrap(index, direction === "left" ? -1 : 1, buttons.length)]!.action;
  redraw();
  return true;
}

/** The two-level focus rule (panelnav) for one key; undefined when the key is not an arrow, enter or esc. */
function stepOf(key: RoutedKey, section: HomePanel, nav: TabsNav, panels: ReturnType<typeof usePanelNav>, rows: RowsBySection) {
  const name = arrowOf(key) ?? (matchKey(key, "enter") ? "enter" : matchKey(key, "esc") ? "esc" : undefined);
  if (!name) return undefined;
  return panelStep({ panel: section, inside: nav.home.inside }, name, (from, dir) => panels.pick(from, dir), (panel) => rows[panel as HomePanel].length);
}
