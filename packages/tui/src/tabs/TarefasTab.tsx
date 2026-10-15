import { useSyncExternalStore } from "react";
import type { Registry, Task } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys, type RoutedKey } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { wrap } from "../panelnav.ts";
import { useRouter, useScreenScope } from "../router.tsx";
import { SessionModals } from "../session/Modals.tsx";
import { List, LogTail, Panel } from "../sdk-ui/kit.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { tabOf } from "./pageTabs.ts";
import { finishedColumns, finishedItem, finishedTasks, runningColumns, runningItem, runningTasks, taskId } from "./tasks-view.ts";
import { useTaskLog } from "./useTasks.ts";

/** Rows of a list reserved besides its items: nothing, since the header and the blank row above it are counted below. */
const SECTION_CHROME_ROWS = 2;
const COLUMN_HEADER_ROWS = 1;
/** Rows of the tab bar, its rule and the footer, and the rows the log keeps at least. */
const PAGE_CHROME_ROWS = 3;
const LOG_MIN_ROWS = 4;
const LOG_TITLE_ROWS = 2;
const EMPTY_RUNNING = "nenhuma tarefa em andamento";
const EMPTY_FINISHED = "nenhuma tarefa nas últimas 24 h";
const FINISHED_ASIDE = "últimas 24 h";
const GUTTER_W = 2;
const FRAME_W = 4;

type SectionId = "running" | "finished";

/** The rows each list may draw: the running ones first, the finished ones take what is left, and the log keeps a few lines. */
export function listRows(screenRows: number, running: number, finished: number): { running: number; finished: number } {
  const chrome = PAGE_CHROME_ROWS + SECTION_CHROME_ROWS * 2 + COLUMN_HEADER_ROWS + LOG_TITLE_ROWS + LOG_MIN_ROWS;
  const room = Math.max(2, screenRows - chrome);
  const runningRows = Math.min(running, Math.max(1, Math.ceil(room / 2)));
  return { running: runningRows, finished: Math.min(finished, Math.max(1, room - runningRows)) };
}

/** Tarefas: the jobs of every module, running and finished in the last 24 hours, and the log of the selected one. */
export function TarefasTab({ store, registry, tasks, now, selected, onSelect }: { store: SessionApi; registry: Registry; tasks: Task[]; now: number; selected?: string; onSelect: (id: string) => void }) {
  const { c, g } = useTheme();
  const { cols, rows } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const router = useRouter();
  const { pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const focused = tabs?.focused ?? true;
  useScreenScope("tasks", 1);

  const running = runningTasks(tasks);
  const finished = finishedTasks(tasks, now);
  const stops = [...stopsOf("running", running), ...stopsOf("finished", finished)];
  const stop = stops.find((candidate) => candidate.id === selected) ?? stops[0]!;
  const current = stop.task;
  const currentId = stop.id;
  const log = useTaskLog(current);
  const shown = listRows(rows, running.length, finished.length);

  const open = () => {
    if (!current) return nudge("nada para abrir");
    const tab = tabOf(registry, current.module);
    if (tab) return tabs?.goto(tab.id);
    nudge("módulo sem aba");
  };
  const stopTask = async () => {
    if (!current || !running.includes(current)) return nudge("nenhuma tarefa rodando aqui");
    const sure = await store.confirm({ title: `parar ${current.name}?`, description: current.module, confirmLabel: "parar", destructive: true });
    if (sure) void store.run(`jobs stop ${current.module} ${current.name}`);
  };
  const resume = () => {
    if (!current?.resumable) return nudge("esta tarefa não continua de uma fase");
    void store.run(`jobs resume ${current.module} ${current.name}`);
  };
  const wholeLog = () => {
    if (!current) return nudge("nada aqui");
    void store.run(`jobs log ${current.module} ${current.name}`);
    tabs?.goto("comando");
  };
  const move = (delta: number) => {
    const index = stops.findIndex((candidate) => candidate.id === currentId) + delta;
    if (index < 0) return tabs?.focusBar();
    onSelect(stops[wrap(index, 0, stops.length)]!.id);
  };
  const jump = (section: SectionId) => onSelect(stops.find((candidate) => candidate.section === section)!.id);
  const onKey = (key: RoutedKey) => {
    if (key.name === "up") return move(-1), true;
    if (key.name === "down") return move(1), true;
    if (key.sequence === "1" || key.sequence === "2") return jump(key.sequence === "1" ? "running" : "finished"), true;
    if (matchKey(key, "enter")) return open(), true;
    if (matchKey(key, "x")) return void stopTask(), true;
    if (matchKey(key, "c")) return resume(), true;
    if (matchKey(key, "l")) return wholeLog(), true;
    if (matchKey(key, "esc")) return tabs?.focusBar(), true;
  };
  useKeys((key) => (focused ? onKey(key) : undefined));

  const active = focused ? stop.section : undefined;
  const width = cols - FRAME_W - GUTTER_W;
  const select = (id: string) => onSelect(id);
  const section = (id: SectionId, title: string, empty: string, body: React.ReactNode, count: number, aside?: string) => (
    <Panel title={title} tone={active === id ? "accent" : undefined} aside={aside} onPress={() => jump(id)}>
      {count ? body : <text wrapMode="none" flexShrink={0} fg={c.dim}>{`  ${empty}`}</text>}
    </Panel>
  );
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1} overflow="hidden">
      {section("running", "[1] em andamento", EMPTY_RUNNING, (
        <List items={running.map((task) => runningItem(task, now, g))} columns={runningColumns(cols)} selected={focused ? currentId : undefined} maxRows={shown.running} onPress={select} />
      ), running.length)}
      {section("finished", "[2] terminadas", EMPTY_FINISHED, (
        <List items={finished.map((task) => finishedItem(task, now, cols, g))} columns={finishedColumns(cols)} selected={focused ? currentId : undefined} maxRows={shown.finished} onPress={select} />
      ), finished.length, FINISHED_ASIDE)}
      {current ? <LogBox name={current.name} lines={log} width={width} /> : null}
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}

/** What the cursor can stop on in a section: its tasks, or one stop for the section itself when it is empty (an empty section is still selectable). */
interface Stop {
  id: string;
  section: SectionId;
  task?: Task;
}

function stopsOf(section: SectionId, tasks: readonly Task[]): Stop[] {
  if (!tasks.length) return [{ id: `empty:${section}`, section }];
  return tasks.map((task) => ({ id: taskId(task), section, task }));
}

function LogBox({ name, lines, width }: { name: string; lines: string[]; width: number }) {
  const { c, g } = useTheme();
  const title = `${g.hline}${g.hline} ${name} · log `;
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} marginTop={1} flexShrink={1}>
      <text wrapMode="none" flexShrink={0} fg={c.dim}>{`${title}${g.hline.repeat(Math.max(0, width - [...title].length))}`}</text>
      <box paddingLeft={GUTTER_W} flexGrow={1} minHeight={0}>
        <LogTail lines={lines} follow />
      </box>
    </box>
  );
}
