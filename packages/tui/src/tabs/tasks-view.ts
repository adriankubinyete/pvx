// What the Tarefas tab says about each task, as pure functions: no UI, so they test without rendering.
import { FINISHED_WINDOW_MS, phasesProgress, type Task } from "@pvx/core";
import type { JobOrigin, ListCell, ListColumn, ListItem, Tone } from "@pvx/sdk";
import { fixedPercent } from "../fixed.ts";
import { clean } from "../palette/search.ts";
import type { Glyphs } from "../theme.ts";

/** The id of a task in the list and in the cursor: `<module>/<name>`. */
export const taskId = (task: Pick<Task, "module" | "name">): string => `${task.module}/${task.name}`;

export const isRunning = (task: Task): boolean => task.status.state === "running";

/** The tasks running now, newest first. */
export const runningTasks = (tasks: readonly Task[]): Task[] => tasks.filter(isRunning);

/** When a finished task ended (when it started, for a record with no end). */
const endedAt = (task: Task): number => task.status.endedAt ?? task.status.startedAt ?? 0;

/** The tasks that ended in the last 24 hours, newest first. */
export function finishedTasks(tasks: readonly Task[], now: number): Task[] {
  return tasks
    .filter((task) => !isRunning(task) && task.status.state !== "none" && now - endedAt(task) <= FINISHED_WINDOW_MS)
    .sort((a, b) => endedAt(b) - endedAt(a));
}

const p2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (at: number) => `${p2(new Date(at).getHours())}:${p2(new Date(at).getMinutes())}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const YESTERDAY_MS = 24 * 60 * 60 * 1000;

const ORIGIN_WORD: Record<JobOrigin, string> = { cron: "cron", manual: "você" };

/** `03:30 cron` today, `ontem 22:10` the day before (the origin is of today's only), `14/10 22:10` before that. */
export function startText(task: Task, now: number): string {
  const at = task.status.startedAt;
  if (at === undefined) return "—";
  const day = new Date(at);
  if (sameDay(day, new Date(now))) return `${hhmm(at)}${task.status.origin ? ` ${ORIGIN_WORD[task.status.origin]}` : ""}`;
  if (sameDay(day, new Date(now - YESTERDAY_MS))) return `ontem ${hhmm(at)}`;
  return `${p2(day.getDate())}/${p2(day.getMonth() + 1)} ${hhmm(at)}`;
}

/** `48 s`, `4 min`, `1 h 05`. */
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${p2(minutes % 60)}`;
}

/** Cells of a duration (`59 min`, `1 h 05`; seven at most): live times are padded to it so what follows does not move. */
export const DURATION_W = 6;

/** How long it ran: until now while it runs, else until it ended. */
export function elapsedMs(task: Task, now: number): number {
  const started = task.status.startedAt ?? now;
  return (isRunning(task) ? now : endedAt(task)) - started;
}

/** The label of the phase that runs now. */
function currentPhase(task: Task): string | undefined {
  return task.phases?.phases.find((phase) => phase.state === "running")?.label;
}

const BAR_W = 8;

/** `████░░░░  61% enviar`: the bar, the percentage in a fixed width and the phase that runs. A task with no phases says only that it runs. */
export function progressText(task: Task, g: Pick<Glyphs, "progressFull" | "progressEmpty">): string {
  if (!task.phases) return "rodando";
  const done = Math.round(phasesProgress(task.phases) * BAR_W);
  const bar = g.progressFull.repeat(done) + g.progressEmpty.repeat(BAR_W - done);
  const phase = currentPhase(task);
  return `${bar} ${fixedPercent(phasesProgress(task.phases) * 100)}${phase ? ` ${clean(phase)}` : ""}`;
}

export interface TaskResult {
  /** `✓ concluída`, `✗ falhou`, `■ parada`. */
  word: string;
  tone: Tone;
  /** What follows the word, dim: where it failed and why, or who stopped it. */
  detail: string;
}

const WHO_STOPPED: Record<JobOrigin, string> = { cron: "pelo cron", manual: "por você" };

function failureDetail(task: Task): string {
  const failure = task.phases?.failure;
  if (failure) {
    const phase = task.phases!.phases.find((candidate) => candidate.id === failure.phase)?.label ?? failure.phase;
    return `em ${clean(phase)}: ${clean(failure.message)}`;
  }
  return task.status.exit === undefined ? "sem notícias do processo" : `código de saída ${task.status.exit}`;
}

export function resultOf(task: Task, g: Pick<Glyphs, "ok" | "error" | "core">): TaskResult {
  if (task.status.state === "done") return { word: `${g.ok} concluída`, tone: "ok", detail: "" };
  if (task.status.state === "stopped") return { word: `${g.core} parada`, tone: "warn", detail: task.status.stoppedBy ? WHO_STOPPED[task.status.stoppedBy] : "" };
  return { word: `${g.error} falhou`, tone: "error", detail: failureDetail(task) };
}

const WIDE_COLS = 100;
const TASK_W = 20;
const TASK_NARROW_W = 16;
const MODULE_W = 11;
const START_W = 11;
const RESULT_W = 12;

/** The columns both lists share, so the rows of the two sections line up. */
function sharedColumns(wide: boolean, titled: boolean): ListColumn[] {
  const title = (text: string) => (titled ? text : undefined);
  return [
    { id: "task", title: title("tarefa"), width: wide ? TASK_W : TASK_NARROW_W },
    { id: "module", title: title("módulo"), width: MODULE_W },
    { id: "start", title: title("início"), width: START_W },
    { id: "time", title: title("tempo"), width: DURATION_W, align: "right" },
  ];
}

export const runningColumns = (cols: number): ListColumn[] => [...sharedColumns(cols >= WIDE_COLS, true), { id: "progress", title: "progresso", grow: 1 }];

/** From 100 columns the cause of a failure has a column of its own; below, it follows the word in one cell. */
export function finishedColumns(cols: number): ListColumn[] {
  const wide = cols >= WIDE_COLS;
  const tail: ListColumn[] = wide ? [{ id: "result", width: RESULT_W }, { id: "detail", grow: 1 }] : [{ id: "result", grow: 1 }];
  return [...sharedColumns(wide, false), ...tail];
}

function sharedCells(task: Task, now: number): Record<string, ListCell> {
  return {
    task: clean(task.name),
    module: clean(task.module),
    start: startText(task, now),
    time: durationText(elapsedMs(task, now)),
  };
}

export const runningItem = (task: Task, now: number, g: Pick<Glyphs, "progressFull" | "progressEmpty">): ListItem => ({
  id: taskId(task),
  cells: { ...sharedCells(task, now), progress: { text: progressText(task, g), tone: "info" } },
});

export function finishedItem(task: Task, now: number, cols: number, g: Pick<Glyphs, "ok" | "error" | "core">): ListItem {
  const result = resultOf(task, g);
  const detail = result.detail;
  if (cols >= WIDE_COLS) return { id: taskId(task), cells: { ...sharedCells(task, now), result: { text: result.word, tone: result.tone }, detail: { text: detail, tone: "dim" } } };
  return { id: taskId(task), cells: { ...sharedCells(task, now), result: { text: detail ? `${result.word} ${detail}` : result.word, tone: result.tone } } };
}

/** The label of the tab: `Tarefas`, with the count of running tasks when there are any. */
export const tabLabel = (running: number): string => (running > 0 ? `Tarefas ${running}` : "Tarefas");
