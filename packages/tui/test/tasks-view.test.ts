import { expect, test } from "bun:test";
import type { Task } from "@pvx/core";
import { durationText, finishedColumns, finishedItem, finishedTasks, progressText, resultOf, runningColumns, runningTasks, startText, tabLabel } from "../src/tabs/tasks-view.ts";
import { glyphs } from "../src/theme.ts";

const G = glyphs.unicode;
/** 2026-10-15 13:39 local. */
const NOW = new Date(2026, 9, 15, 13, 39).getTime();
const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).getTime();

const task = (name: string, status: Task["status"], extra: Partial<Task> = {}): Task => ({ module: "autobackup", name, line: "run", status, resumable: false, ...extra });
const phases = (overrides: Partial<NonNullable<Task["phases"]>> = {}): NonNullable<Task["phases"]> => ({
  startedAt: 1, runStartedAt: 1,
  phases: [{ id: "dump", label: "dump", weight: 1, state: "done" }, { id: "upload", label: "enviar", weight: 1, state: "running", progress: 0.22 }],
  ...overrides,
});

test("the start says the time and who started it for today, `ontem` for the day before, the date before that", () => {
  expect(startText(task("a", { state: "running", startedAt: at(15, 3, 30), origin: "cron" }), NOW)).toBe("03:30 cron");
  expect(startText(task("a", { state: "done", startedAt: at(15, 11, 29), origin: "manual" }), NOW)).toBe("11:29 você");
  expect(startText(task("a", { state: "done", startedAt: at(15, 11, 29) }), NOW)).toBe("11:29");
  expect(startText(task("a", { state: "stopped", startedAt: at(14, 22, 10), origin: "manual" }), NOW)).toBe("ontem 22:10");
  expect(startText(task("a", { state: "done", startedAt: at(12, 8, 5) }), NOW)).toBe("12/10 08:05");
  expect(startText(task("a", { state: "none" }), NOW)).toBe("—");
});

test("durations are seconds, minutes, then hours", () => {
  expect(durationText(2_000)).toBe("2 s");
  expect(durationText(48_000)).toBe("48 s");
  expect(durationText(4 * 60_000 + 20_000)).toBe("4 min");
  expect(durationText(41 * 60_000)).toBe("41 min");
  expect(durationText(65 * 60_000)).toBe("1 h 05");
  expect(durationText(-5)).toBe("0 s");
});

test("the progress is the bar, the percentage in a fixed width and the phase that runs", () => {
  expect(progressText(task("a", { state: "running" }, { phases: phases() }), G)).toBe("█████░░░  61% enviar");
  const done = phases();
  done.phases.forEach((phase) => (phase.state = "done"));
  expect(progressText(task("a", { state: "running" }, { phases: done }), G)).toBe("████████ 100%");
  expect(progressText(task("a", { state: "running" }), G)).toBe("rodando"); // no phases: only that it runs
});

test("the result is done, failed with the phase and the cause, or stopped with who stopped it", () => {
  expect(resultOf(task("a", { state: "done" }), G)).toEqual({ word: "✓ concluída", tone: "ok", detail: "" });
  const failed = phases({ failure: { phase: "dump", message: "sem espaço" } });
  expect(resultOf(task("a", { state: "failed" }, { phases: failed }), G)).toEqual({ word: "✗ falhou", tone: "error", detail: "em dump: sem espaço" });
  expect(resultOf(task("a", { state: "failed", exit: 2 }), G).detail).toBe("código de saída 2");
  expect(resultOf(task("a", { state: "failed" }), G).detail).toBe("sem notícias do processo");
  expect(resultOf(task("a", { state: "stopped", stoppedBy: "manual" }), G)).toEqual({ word: "■ parada", tone: "warn", detail: "por você" });
  expect(resultOf(task("a", { state: "stopped" }), G).detail).toBe("");
});

test("running tasks are the running ones; finished are the last 24 hours, newest first", () => {
  const list = [
    task("agora", { state: "running", startedAt: at(15, 13, 35) }),
    task("antiga", { state: "done", startedAt: at(13, 1, 0), endedAt: at(13, 1, 5) }),
    task("ontem", { state: "failed", startedAt: at(14, 22, 10), endedAt: at(14, 22, 11) }),
    task("hoje", { state: "done", startedAt: at(15, 12, 0), endedAt: at(15, 12, 1) }),
    task("nenhuma", { state: "none" }),
  ];
  expect(runningTasks(list).map((t) => t.name)).toEqual(["agora"]);
  expect(finishedTasks(list, NOW).map((t) => t.name)).toEqual(["hoje", "ontem"]);
});

test("the cause of a failure has its own column from 100 columns and follows the word below; the shared columns line up", () => {
  const failed = task("a", { state: "failed", startedAt: at(15, 13, 0), endedAt: at(15, 13, 1) }, { phases: phases({ failure: { phase: "dump", message: "sem espaço" } }) });
  expect(finishedColumns(120).map((c) => c.id)).toEqual(["task", "module", "start", "time", "result", "detail"]);
  expect(finishedColumns(80).map((c) => c.id)).toEqual(["task", "module", "start", "time", "result"]);
  expect(finishedItem(failed, NOW, 120, G).cells).toMatchObject({ result: { text: "✗ falhou" }, detail: { text: "em dump: sem espaço", tone: "dim" } });
  expect(finishedItem(failed, NOW, 80, G).cells).toMatchObject({ result: { text: "✗ falhou em dump: sem espaço", tone: "error" } });
  for (const cols of [80, 120]) {
    const shared = (list: { id: string; width?: number }[]) => list.slice(0, 4).map((c) => [c.id, c.width]);
    expect(shared(runningColumns(cols))).toEqual(shared(finishedColumns(cols)));
  }
});

test("the tab label counts the running tasks", () => {
  expect(tabLabel(0)).toBe("Tarefas");
  expect(tabLabel(1)).toBe("Tarefas 1");
});
