import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RGBA } from "@opentui/core";
import { createLogger, createRegistry, createStore, jobsConfig, loadModules, logsDir, phasesKey, pvxHome, runCapture, tuiStatePath, writeJobState, appendJobLog, readJobState, type Registry } from "@pvx/core";
import type { PhasesState } from "@pvx/sdk";
import { expectButtonsReachable, expectNoKeyboardTrap, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, ui } from "../src/index.ts";
import { tokens } from "../src/theme.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
let registry: Registry;
const saved = { ...jobsConfig };
const children: { kill(): void }[] = [];
afterEach(() => {
  h?.destroy();
  children.splice(0).forEach((child) => child.kill());
  Object.assign(jobsConfig, saved);
});
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  jobsConfig.selfCmd = () => ["true"]; // a resume starts a detached `true`: it never runs a real job
  jobsConfig.systemd = () => false;
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }), ui });
});

const MIN = 60_000;
const phases = (overrides: Partial<PhasesState> = {}): PhasesState => ({
  startedAt: Date.now() - 10 * MIN, runStartedAt: Date.now() - 10 * MIN,
  phases: [{ id: "dump", label: "dump", weight: 1, state: "done" }, { id: "upload", label: "enviar", weight: 1, state: "running", progress: 0.22 }],
  ...overrides,
});

/** One running task (a real child process: `jobs stop` kills it), a finished one, a failed one that can continue and a stopped one. */
function seedTasks() {
  const child = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  children.push(child);
  const now = Date.now();
  writeJobState("autobackup", "backup-noite", { state: "running", startedAt: now - 4 * MIN, pid: child.pid, origin: "cron", line: "run noite" });
  createStore("autobackup").set(phasesKey("backup-noite"), phases({ runStartedAt: now - 4 * MIN }));
  for (const line of ["enviado issabelbackup-1.tar (380 MB)", "enviando recordings.tar (812 MB)", "nova tentativa 1/3 em 5 s"]) appendJobLog("autobackup", "backup-noite", line);
  writeJobState("issabel", "netinstall", { state: "done", startedAt: now - 61 * MIN, endedAt: now - 20 * MIN, origin: "manual", line: "netinstall" });
  appendJobLog("issabel", "netinstall", "instalação concluída");
  writeJobState("autobackup", "backup-mysql", { state: "failed", startedAt: now - 30 * MIN, endedAt: now - 30 * MIN + 2000, origin: "cron", line: "run mysql" });
  createStore("autobackup").set(phasesKey("backup-mysql"), phases({ runStartedAt: now - 30 * MIN, failure: { phase: "dump", message: "sem espaço" }, phases: [{ id: "dump", label: "dump", weight: 1, state: "failed" }, { id: "upload", label: "enviar", weight: 1, state: "pending" }] }));
  appendJobLog("autobackup", "backup-mysql", "sem espaço em /var/www/backup");
  writeJobState("ui-demo", "firewall-revert", { state: "stopped", startedAt: now - 3 * 60 * MIN, endedAt: now - 3 * 60 * MIN + 30_000, origin: "manual", stoppedBy: "manual", line: "revert" });
  return child;
}

async function mount(opts: { cols?: number; rows?: number; enabled?: boolean } = {}) {
  mkdirSync(dirname(tuiStatePath()), { recursive: true });
  writeFileSync(tuiStatePath(), JSON.stringify({ showTasksTab: opts.enabled ?? true }));
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={tuiStatePath()} pages={{ session: store, registry, makeLogger }} />, { cols: opts.cols, rows: opts.rows });
  return { t: h, store };
}

const lines = (t: TuiHarness) => t.frame().split("\n");
const rowOf = (t: TuiHarness, text: string) => lines(t).slice(2).find((l) => l.includes(text))!;
/** Walks the tab bar to Tarefas and goes into it. */
const gotoTarefas = async (t: TuiHarness) => {
  for (let i = 0; i < 12; i++) {
    if (/Tarefas/.test(lines(t)[0]!) && t.frame().includes("Em andamento")) break;
    await t.press("TAB");
  }
  await t.press("ARROW_DOWN");
};

test("the Tarefas tab is hidden by default, and when on it sits between the module tabs and Logs with the count of running tasks", async () => {
  const { t } = await mount({ enabled: false });
  expect(lines(t)[0]).not.toContain("Tarefas");
  t.destroy();
  seedTasks();
  const on = await mount();
  expect(lines(on.t)[0]).toMatch(/Demo\s+Tarefas 1\s+Logs/);
});

test("Tarefas at 120x40: the running task with its bar and phase, the finished ones with their result, and the log of the selected one", async () => {
  seedTasks();
  const { t } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  const f = t.frame();
  for (const s of ["1 Em andamento", "tarefa", "módulo", "início", "tempo", "progresso", "backup-noite", "autobackup", "cron", "4 min", "█████░░░  61% enviar", "2 Terminadas", "últimas 24 h", "netinstall", "issabel", "você", "✓ concluída", "✗ falhou", "em dump: sem espaço", "■ parada", "por você", "backup-noite · log", "enviando recordings.tar (812 MB)", "nova tentativa 1/3 em 5 s"]) expect(f, s).toContain(s);
  expect(f).not.toContain("terminal pequeno");
  for (const l of lines(t)) expect(l.length).toBeLessThanOrEqual(120);
});

test("Tarefas at 80x24: the same sections in one column, the cause after the word, the log keeps a few lines", async () => {
  seedTasks();
  const { t } = await mount({ cols: 80, rows: 24 });
  await gotoTarefas(t);
  const f = t.frame();
  for (const s of ["1 Em andamento", "backup-noite", "61%", "2 Terminadas", "✓ concluída", "✗ falhou", "backup-noite · log", "nova tentativa 1/3 em 5 s"]) expect(f, s).toContain(s);
  for (const l of lines(t)) expect(l.length).toBeLessThanOrEqual(80);
  expect(lines(t).at(-2)! + lines(t).at(-1)!).toContain("x para");
});

test("a finished task is `concluída` in the success token, never the accent; the failure is in the error token", async () => {
  seedTasks();
  const { t } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  const spanOf = (text: string) => {
    const y = lines(t).findIndex((l) => l.includes(text));
    return t.spans().lines[y]!.spans.find((span) => span.text.includes(text))!;
  };
  expect(spanOf("✓ concluída").fg.equals(RGBA.fromHex(tokens.ok))).toBe(true);
  expect(spanOf("✗ falhou").fg.equals(RGBA.fromHex(tokens.error))).toBe(true);
  expect(spanOf("■ parada").fg.equals(RGBA.fromHex(tokens.warn))).toBe(true);
});

test("↑↓ walk the running ones then the finished ones, the log follows the selected task, ↑ on the first goes to the bar", async () => {
  seedTasks();
  const { t } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  expect(rowOf(t, "backup-noite")).toContain("»");
  await t.press("ARROW_DOWN");
  expect(rowOf(t, "netinstall")).toContain("»");
  expect(t.frame()).toContain("netinstall · log");
  expect(t.frame()).toContain("instalação concluída");
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN"); // wraps to the running one
  expect(rowOf(t, "backup-noite")).toContain("»");
  await t.press("2");
  expect(rowOf(t, "netinstall")).toContain("»");
  await t.press("1");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("troca aba");
});

test("x asks before stopping, then `jobs stop` runs through the session and the job becomes stopped", async () => {
  const child = seedTasks();
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  await t.press("x");
  expect(t.frame()).toContain("parar backup-noite?");
  await t.press("ESCAPE"); // the safe answer
  expect(store.blocks).toEqual([]);
  await t.press("x");
  await t.press("ARROW_LEFT"); // [ parar ]
  await t.press("RETURN");
  await t.flush();
  await Bun.sleep(300);
  expect(store.blocks.map((b) => b.line)).toEqual(["jobs stop autobackup backup-noite"]);
  expect(readJobState("autobackup", "backup-noite")?.state).toBe("stopped");
  expect(child.killed || child.exitCode !== null || child.signalCode !== null).toBe(true);
});

test("x on a finished task says there is nothing to stop", async () => {
  seedTasks();
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  await t.press("ARROW_DOWN");
  await t.press("x");
  expect(lines(t).at(-1)! + lines(t).at(-2)!).toContain("nenhuma tarefa rodando aqui");
  expect(store.blocks).toEqual([]);
});

test("c continues a failed task from its phase (`jobs resume`), and refuses a task that has no phase to continue", async () => {
  seedTasks();
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  await t.press("ARROW_DOWN"); // netinstall: done, nothing to continue
  await t.press("c");
  expect(lines(t).at(-1)! + lines(t).at(-2)!).toContain("não continua de uma fase");
  expect(store.blocks).toEqual([]);
  await t.press("ARROW_DOWN"); // backup-mysql: failed in dump, phases left
  await t.press("c");
  await Bun.sleep(300);
  await t.flush();
  expect(store.blocks.map((b) => b.line)).toEqual(["jobs resume autobackup backup-mysql"]);
  expect(store.blocks[0]!.lines.map((l) => l.text).join("\n")).toContain("continuando");
});

test("l shows the whole log in the Comando (`jobs log`)", async () => {
  seedTasks();
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  await t.press("l");
  await Bun.sleep(200);
  await t.flush();
  expect(store.blocks.map((b) => b.line)).toEqual(["jobs log autobackup backup-noite"]);
  expect(t.frame()).toContain("tab completa"); // the Comando
  expect(t.frame()).toContain("enviado issabelbackup-1.tar (380 MB)");
});

test("enter opens the tab of the module that owns the task, or says it has none", async () => {
  seedTasks();
  const { t } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  await t.press("RETURN"); // autobackup has no tab here
  expect(lines(t).at(-1)! + lines(t).at(-2)!).toContain("módulo sem aba");
  for (let i = 0; i < 3; i++) await t.press("ARROW_DOWN"); // netinstall, backup-mysql, firewall-revert (module ui-demo, which has a tab)
  await t.press("RETURN");
  expect(t.frame()).not.toContain("Em andamento"); // the Demo tab is open now
});

/** The numbers of the sections that carry the `▌` gutter: the active one. */
const activeSections = (t: TuiHarness) => lines(t).flatMap((l) => /▌ (\d) /.exec(l)?.[1] ?? []);

test("an empty section is still selectable: the arrows, the numbers and a click land on it and it shows the active gutter and its empty line", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  for (let i = 0; i < 12 && !t.frame().includes("Em andamento"); i++) await t.press("TAB");
  expect(t.frame()).toContain("nenhuma tarefa em andamento");
  expect(t.frame()).toContain("nenhuma tarefa nas últimas 24 h");
  await t.press("ARROW_DOWN"); // into the tab: the first section, empty
  expect(activeSections(t)).toEqual(["1"]);
  await t.press("ARROW_DOWN"); // the second section, empty too: the cursor does not skip it
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("RETURN"); // nothing to open: harmless
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("1");
  expect(activeSections(t)).toEqual(["1"]);
  const y = lines(t).findIndex((l) => l.includes("2 Terminadas"));
  await t.click(10, y);
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("x");
  await t.press("c");
  await t.press("l");
  expect(activeSections(t)).toEqual(["2"]); // nothing moved, nothing ran
  expectButtonsReachable();
  await expectNoKeyboardTrap(t);
});

test("an empty section between tasks is not skipped", async () => {
  const now = Date.now();
  writeJobState("issabel", "netinstall", { state: "done", startedAt: now - 61 * MIN, endedAt: now - 20 * MIN, origin: "manual", line: "netinstall" });
  const { t } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  expect(activeSections(t)).toEqual(["1"]); // nothing runs: the first stop is the empty section
  await t.press("ARROW_DOWN");
  expect(rowOf(t, "netinstall")).toContain("»");
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("ARROW_UP");
  expect(activeSections(t)).toEqual(["1"]);
});

test("with tasks the keyboard is free too: esc from inside reaches the bar", async () => {
  seedTasks();
  const { t } = await mount({ cols: 120, rows: 40 });
  await gotoTarefas(t);
  await expectNoKeyboardTrap(t);
});
