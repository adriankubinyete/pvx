import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import type { JobStatus, PhasesState } from "@pvx/sdk";
import { renderPage, renderTui, runSession, type TuiHarness } from "../../testing/src/index.ts";
import { ThemeProvider } from "../src/index.ts";
import { LogTail, Notice, Panel } from "../src/sdk-ui/kit.tsx";
import { isCurrentRun, jobViewOf, runViewOf, stepsOf } from "../src/sdk-ui/run.ts";
import { windowStart } from "../src/sdk-ui/window.ts";

const KIT = join(import.meta.dir, "../../core/test/fixtures/jobmodules/kit-demo");
const PAGE_DOWN = "\x1b[6~"; // the harness has no name for it
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

/** Polls by time and flushes inside `act` (`waitForFrame` counts frames and warns about updates outside it). */
async function until(text: string, ms = 3000): Promise<void> {
  for (const end = Date.now() + ms; !h!.frame().includes(text) && Date.now() < end; ) {
    await Bun.sleep(10);
    await h!.flush();
  }
  expect(h!.frame()).toContain(text);
}

test("windowStart keeps the selection in view and moves as little as it can", () => {
  expect(windowStart(8, 0, 3, 0)).toBe(0);
  expect(windowStart(8, 2, 3, 0)).toBe(0);
  expect(windowStart(8, 3, 3, 0)).toBe(1);
  expect(windowStart(8, 2, 3, 1)).toBe(1); // inside: holds still
  expect(windowStart(8, 0, 3, 5)).toBe(0); // wrapped to the top
  expect(windowStart(8, -1, 3, 4)).toBe(4); // no selection: stays
  expect(windowStart(2, 1, 3, 4)).toBe(0); // fewer rows than the window
});

test("List maxRows draws only the window and scrolls with the selection; enter opens the row action", async () => {
  h = await renderPage(KIT, "rows", { cols: 80, rows: 24 });
  expect(h.frame()).toContain("linha c");
  expect(h.frame()).not.toContain("linha d");
  for (const _ of "jjj") await h.press("j");
  expect(h.frame()).toContain("linha d");
  expect(h.frame()).not.toContain("linha a");
  await h.press("RETURN");
  expect(h.frame()).toContain("aberta=d");
  expect(h.frame()).toContain("enter abrir"); // the footer shows the row action
});

test("clicking a row calls the row action", async () => {
  h = await renderPage(KIT, "rows", { cols: 80, rows: 24 });
  const y = h.frame().split("\n").findIndex((line) => line.includes("linha b"));
  await h.click(6, y);
  expect(h.frame()).toContain("aberta=b");
});

test("with actionOnClick false a click only selects; a second click on the selected row, or enter, opens it", async () => {
  h = await renderPage(KIT, "rows-select", { cols: 80, rows: 24 });
  const y = h.frame().split("\n").findIndex((line) => line.includes("linha b"));
  await h.click(6, y);
  expect(h.frame()).toContain("aberta=nenhuma");
  expect(h.frame()).toMatch(/» linha b/);
  await h.click(6, y);
  expect(h.frame()).toContain("aberta=b");
});

test("useNudge tones: warn and error show their glyph and text in the footer, like ok", async () => {
  h = await renderPage(KIT, "rows", { cols: 80, rows: 24 });
  await h.press("w");
  expect(h.frame()).toContain("▲ cuidado");
  await h.press("x");
  expect(h.frame()).toContain("✗ quebrou");
  expect(h.frame()).not.toContain("cuidado");
});

test("Notice draws the level marker and the text; useNudge(msg, 'ok') shows a success notice", async () => {
  h = await renderPage(KIT, "rows", { cols: 80, rows: 24 });
  expect(h.frame()).toMatch(/\[!\] precisa aplicar/);
  await h.press("n");
  expect(h.frame()).toContain("✓ salvo");
});

test("a shrinkable Panel gives up height instead of pushing the footer off the screen", async () => {
  const body = Array.from({ length: 12 }, (_, i) => <text key={i}>{`linha ${i}`}</text>);
  const view = (shrink: boolean): ReactNode => (
    <ThemeProvider>
      <box flexDirection="column" height={6}>
        <Panel title="p" shrink={shrink}>{body}</Panel>
        <text>rodapé</text>
      </box>
    </ThemeProvider>
  );
  h = await renderTui(view(true), { cols: 30, rows: 6 });
  expect(h.frame()).toContain("rodapé");
  h.destroy();
  h = await renderTui(view(false), { cols: 30, rows: 6 });
  expect(h.frame()).not.toContain("rodapé");
});

test("LogTail with focused scrolls by keyboard: home goes to the start, end follows again", async () => {
  const lines = Array.from({ length: 40 }, (_, i) => `linha ${i + 1}`);
  const tail = (focused: boolean): ReactNode => <ThemeProvider><box height={8} flexDirection="column"><LogTail lines={lines} focused={focused} /></box></ThemeProvider>;
  h = await renderTui(tail(true), { cols: 40, rows: 8 });
  expect(h.frame()).toContain("linha 40");
  await h.press("HOME");
  expect(h.frame()).toContain("linha 1");
  expect(h.frame()).not.toContain("linha 40");
  await h.press(PAGE_DOWN);
  expect(h.frame()).not.toContain("linha 1 ");
  await h.press("END");
  expect(h.frame()).toContain("linha 40");
  h.destroy();
  h = await renderTui(tail(false), { cols: 40, rows: 8 });
  await h.press("HOME");
  expect(h.frame()).toContain("linha 40"); // not focused: the keys are not taken
});

test("useQuery refetch reads again at once and keeps the data", async () => {
  h = await renderPage(KIT, "refetch", { cols: 80, rows: 24 });
  await until("count=1");
  await h.press("r");
  await until("count=2");
});

test("Notice is a result line in the level's color", async () => {
  h = await renderTui(<ThemeProvider><Notice level="error">falhou</Notice></ThemeProvider>, { cols: 30, rows: 3 });
  expect(h.frame()).toContain("[✗] falhou");
});

test("a run that failed shows its phases, then done after the fix resumes it", async () => {
  const session = await runSession(KIT);
  await session.run("kit-demo break");
  const failed = await session.run("kit-demo install");
  expect(failed.text).toContain("parou em database");
  h = await session.renderPage("run", { cols: 80, rows: 24 });
  expect(h.frame()).toContain("view=failed");
  expect(h.frame()).toContain("database:failed");
  expect(h.frame()).toContain("repos:done");
  h.destroy();
  await session.run("kit-demo fix");
  const resumed = await session.run("kit-demo install");
  expect(resumed.text).toContain("fase repos: já concluída, pulando");
  h = await session.renderPage("run", { cols: 80, rows: 24 });
  expect(h.frame()).toContain("view=done");
  expect(h.frame()).toContain("progress=100");
});

const status = (state: JobStatus["state"], startedAt?: number): JobStatus => ({ state, startedAt });
const phasesState = (states: PhasesState["phases"][number]["state"][], extra: Partial<PhasesState> = {}): PhasesState => ({
  phases: states.map((state, index) => ({ id: `p${index}`, label: `p${index}`, weight: 1, state })),
  startedAt: 100,
  runStartedAt: 100,
  ...extra,
});

test("jobViewOf: a running job that stopped writing is stale", () => {
  expect(jobViewOf(status("running"), 1000, 30_000)).toBe("running");
  expect(jobViewOf(status("running"), 30_000, 30_000)).toBe("stale");
  expect(jobViewOf(status("failed"), 999_999, 30_000)).toBe("failed");
  expect(jobViewOf(status("none"), 0)).toBe("idle");
});

test("runViewOf: done stays done without the job, an interrupted run is failed, a leftover of an older job is idle", () => {
  const partial = phasesState(["done", "pending"]);
  expect(runViewOf("done", phasesState(["done", "skipped"]), true)).toBe("done");
  expect(runViewOf("idle", partial, true)).toBe("failed");
  expect(runViewOf("running", partial, true)).toBe("running");
  expect(runViewOf("stale", partial, true)).toBe("stale");
  expect(runViewOf("failed", phasesState(["done", "failed"], { failure: { phase: "p1", message: "x" } }), true)).toBe("failed");
  expect(runViewOf("idle", partial, false)).toBe("idle");
  expect(isCurrentRun(phasesState(["done"], { runStartedAt: 50 }), status("done", 100))).toBe(false);
  expect(isCurrentRun(phasesState(["done"], { runStartedAt: 150 }), status("done", 100))).toBe(true);
  expect(stepsOf(partial, 500).map((step) => step.state)).toEqual(["done", "pending"]);
});

test("runViewOf: a trailing phase does not hold done back, a failure still fails, and loading is idle", () => {
  const countdown = phasesState(["done", "running"]);
  expect(runViewOf("running", countdown, true)).toBe("running");
  expect(runViewOf("running", countdown, true, ["p1"])).toBe("done");
  expect(runViewOf("idle", countdown, true, ["p1"])).toBe("done");
  expect(runViewOf("running", phasesState(["running", "pending"]), true, ["p1"])).toBe("running");
  expect(runViewOf("failed", phasesState(["done", "failed"], { failure: { phase: "p1", message: "x" } }), true, ["p1"])).toBe("failed");
  expect(runViewOf("idle", phasesState(["done", "pending"]), true, [], true)).toBe("idle");
});

/** A run in the middle: a saved state with `database` running, and a job state that says the same, as the job's own process would leave them. */
function leaveRunning(home: string, startedAt: number): void {
  const root = join(home, "modules", "kit-demo");
  mkdirSync(join(root, "jobs"), { recursive: true });
  const record = (id: string, state: string, extra = {}) => ({ id, label: id, weight: 1, state, ...extra });
  const phases = [record("repos", "done", { startedAt, endedAt: startedAt }), record("packages", "done", { startedAt, endedAt: startedAt }), record("database", "running", { startedAt })];
  mkdirSync(join(root, "state"), { recursive: true });
  writeFileSync(join(root, "state", "state.json"), JSON.stringify({ "phases:setup": { phases, startedAt, runStartedAt: startedAt } }));
  writeFileSync(join(root, "jobs", "setup.json"), JSON.stringify({ state: "running", startedAt, pid: process.pid, line: "install" }));
  writeFileSync(join(root, "jobs", "setup.log"), "i x\n");
}

test("useRun: loading is true until the first poll, the step times tick by themselves, and a trailing phase lets the view be done", async () => {
  const session = await runSession(KIT);
  leaveRunning(session.home, Date.now() - 5000);
  h = await session.renderPage("run", { cols: 90, rows: 24 });
  expect(h.frame()).not.toContain("view=failed"); // the saved state is there before the first poll of the job: it must not read as an interrupted run
  await until("loading=false");
  expect(h.frame()).toContain("view=running");
  const first = Number(h.frame().match(/seconds=\d+,\d+,(\d+)/)?.[1]);
  expect(first).toBeGreaterThanOrEqual(5);
  await Bun.sleep(1300);
  await h.flush();
  expect(Number(h.frame().match(/seconds=\d+,\d+,(\d+)/)?.[1])).toBeGreaterThan(first);
  h.destroy();
  h = await session.renderPage("run-trailing", { cols: 90, rows: 24 });
  await until("loading=false");
  expect(h.frame()).toContain("view=done");
  expect(h.frame()).toContain("database:running");
}, 15_000);
