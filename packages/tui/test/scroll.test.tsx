import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { auditFile, createLogger, createRegistry, loadModules, logsDir, pvxHome } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Session, Tabs } from "../src/index.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let exits = 0;
let store: ReturnType<typeof createSessionStore>;
async function load() {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  const registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
  return registry;
}
async function mount(o: { isRoot?: boolean; shellTimeoutMs?: number } = {}) {
  if (!h) exits = 0;
  const registry = await load();
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  store = createSessionStore({ registry, makeLogger, historyPath: join(pvxHome(), "tui-history"), isRoot: o.isRoot ?? true, shellTimeoutMs: o.shellTimeoutMs });
  h = await renderTui(
    <App root={{ id: "sessao", element: <Session store={store} registry={registry} /> }} logger={makeLogger("core")} onExit={() => void exits++} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: 100, rows: 24 },
  );
  return h;
}
const run = async (t: TuiHarness, line: string) => {
  await t.type(line);
  await t.press("RETURN");
  await t.flush();
};

/** Polls in real time (the harness `waitFor` counts frames, too few for a real process). */
const until = async (t: TuiHarness, pred: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !pred() && Date.now() < end; ) (await Bun.sleep(25), await t.flush());
  expect(pred()).toBe(true);
};
const fill = async (t: TuiHarness, n: number) => {
  for (let i = 0; i < n; i++) await store.run(`demo greet n${i}`);
  await t.flush();
};

test("scrollback follows the newest block once output exceeds the height", async () => {
  const t = await mount();
  await fill(t, 12);
  expect(t.frame()).toContain("oi n11");
  expect(t.frame()).not.toContain("oi n0");
});

test("PageUp keeps the view; a new command jumps to the bottom", async () => {
  const t = await mount();
  await fill(t, 12);
  await t.press("\x1b[5~");
  await t.press("\x1b[5~");
  expect(t.frame()).not.toContain("oi n11");
  await t.flush();
  expect(t.frame()).not.toContain("oi n11");
  await run(t, "demo greet n12");
  expect(t.frame()).toContain("oi n12");
});

const audit = () => { try { return readFileSync(auditFile(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test("!cmd runs in the host shell: stdout in a block, exit 0, audited and in the history", async () => {
  const t = await mount();
  await run(t, "!echo oi");
  await until(t, () => store.blocks[0]?.status === "ok");
  expect(store.blocks[0]).toMatchObject({ line: "!echo oi", status: "ok", lines: [{ kind: "plain", text: "oi" }] });
  expect(store.history).toContain("!echo oi");
  expect(audit().at(-1)).toMatchObject({ kind: "cmd", line: "!echo oi", exit: 0 }); // no PVX_AUDIT: always written
  await run(t, "!!"); // repeat, not a shell line of its own
  await until(t, () => store.blocks[1]?.status === "ok");
  expect(store.blocks[1]!.line).toBe("!echo oi");
});

test("!cmd: exit code sets the status, stderr is warning, then error on failure; ANSI is stripped", async () => {
  const t = await mount();
  await run(t, "!sh -c 'echo bad >&2; exit 3'");
  await until(t, () => store.blocks[0]?.status === "error");
  expect(store.blocks[0]!.lines).toEqual([{ kind: "error", text: "bad" }]);
  await run(t, "!printf '\\033[31mred\\033[0m\\n'");
  await until(t, () => store.blocks[1]?.status === "ok");
  expect(store.blocks[1]!.lines).toEqual([{ kind: "plain", text: "red" }]);
  expect(audit().at(-1)).toMatchObject({ line: expect.stringContaining("!printf"), exit: 0 });
});

test("!cmd runs without root, unaudited when the audit file is unwritable; interactive programs are refused", async () => {
  const t = await mount({ isRoot: false });
  process.env.PVX_HOME = "/nonexistent/pvx";
  await run(t, "!echo oi");
  await until(t, () => store.blocks[0]?.status === "ok");
  expect(store.blocks[0]!.lines).toEqual([{ kind: "plain", text: "oi" }]);
  expect(audit()).toEqual([]);
  t.destroy();
  const u = await mount();
  await run(u, "!vim x");
  expect(u.frame()).toContain("precisa de um terminal interativo");
  expect(store.blocks[0]!.status).toBe("error");
});

test("ctrl+c while a !cmd runs kills it; the session stays", async () => {
  const t = await mount();
  await run(t, "!sleep 30");
  expect(store.blocks[0]!.status).toBe("running");
  await t.press("c", { ctrl: true });
  await until(t, () => store.blocks[0]?.status === "error");
  expect(store.blocks[0]!.lines.at(-1)).toEqual({ kind: "error", text: "encerrado pelo usuário" });
  expect(store.blocks[0]!.status).toBe("error");
  expect(exits).toBe(0);
  await t.flush();
  expect(t.frame()).toContain("comando encerrado · ctrl+c de novo para sair");
  expect(store.cancel()).toBe(false);
});

test("a second ctrl+c within 2 s quits; with nothing running the first one quits", async () => {
  const t = await mount();
  await run(t, "!sleep 30");
  await t.press("c", { ctrl: true });
  expect(exits).toBe(0);
  await t.press("c", { ctrl: true });
  expect(exits).toBe(1);
  expect(store.cancel()).toBe(false);
  const u = await mount();
  await u.press("c", { ctrl: true });
  expect(exits).toBe(2);
});

test("x kills the focused running block (exit 130); the hint shows only while it runs", async () => {
  const t = await mount();
  await run(t, "!sleep 30");
  await t.press("ESCAPE"); // input -> last block
  await Bun.sleep(150);
  await t.flush();
  expect(t.frame()).toContain("x encerrar");
  const t0 = Date.now();
  await t.press("x");
  await until(t, () => store.blocks[0]?.status === "error");
  expect(Date.now() - t0).toBeLessThan(1500);
  expect(store.blocks[0]!.lines.at(-1)).toEqual({ kind: "error", text: "encerrado pelo usuário" });
  expect(t.frame()).toContain("encerrado pelo usuário");
  expect(t.frame()).not.toContain("x encerrar");
});

test("the block footer shows esc once", async () => {
  const t = await mount();
  await run(t, "!echo oi");
  await until(t, () => store.blocks[0]?.status === "ok");
  await t.press("ESCAPE");
  await Bun.sleep(150);
  await t.flush();
  const foot = t.frame().split("\n").filter((l) => l.includes("esc abas")).join("");
  expect(foot).toContain("esc abas");
  expect(foot).not.toContain("esc voltar");
  expect(t.frame()).not.toContain("x encerrar"); // finished block
});

test("a !cmd past the timeout is killed", async () => {
  const t = await mount({ shellTimeoutMs: 200 });
  await run(t, "!sleep 30");
  await until(t, () => store.blocks[0]?.status === "error");
  expect(store.blocks[0]!.lines.at(-1)!.text).toContain("tempo esgotado");
});

test("streamed output of a running !cmd follows the bottom, and PageUp stops the following", async () => {
  const t = await mount();
  await run(t, "!i=0; while [ $i -lt 30 ]; do echo l$i; i=$((i+1)); sleep 0.02; done");
  await until(t, () => t.frame().includes("l29"));
  const f = t.frame();
  expect(f).toContain("l29");
  await run(t, "!sh -c 'i=0; while [ $i -lt 30 ]; do echo m$i; i=$((i+1)); sleep 0.05; done'");
  await t.press("\x1b[5~");
  await t.press("\x1b[5~");
  await until(t, () => store.blocks.at(-1)!.status !== "running");
  expect(t.frame()).not.toContain("m29");
}, 20000);

test("the Logs tab refreshes on its own while visible, follows the end, and stops on leave", async () => {
  const registry = await load();
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  let calls = 0;
  const st = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: async () => (calls++, { exit: 0, lines: Array.from({ length: 50 + calls }, (_, i) => ({ kind: "plain" as const, text: `L${i + 1}` })) }),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={st} registry={registry} nav={createTabsNav()} version="0.1.0" logsMs={60} /> };
  const t = (h = await renderTui(<App root={root} logger={{ debug() {}, info() {}, warn() {}, error() {} }} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: st, registry }} />, { cols: 100, rows: 24 }));
  await t.press("TAB");
  await t.press("TAB"); // Logs
  await until(t, () => calls >= 3);
  expect(t.frame()).toMatch(/atualizado \d\d:\d\d:\d\d/);
  await until(t, () => t.frame().includes(`L${50 + calls}`)); // the end of the longer output is on screen
  await t.press("TAB"); // Comando
  const seen = calls;
  await Bun.sleep(250);
  expect(calls).toBe(seen);
});

test("typing a core command prefix and tab completes it", async () => {
  const t = await mount();
  await t.type("modul");
  expect(t.frame()).toContain("modules");
  await t.press("TAB");
  expect(t.frame()).toContain("❯ modules ");
});

test("typing `!` switches the prompt to `$`, a shell block keeps the marker, backspace returns to normal", async () => {
  const t = await mount();
  expect(t.frame()).toContain("❯ ");
  await t.type("!");
  expect(t.frame()).toContain("$ !");
  expect(t.frame()).toContain("host shell · enter roda");
  await t.press("BACKSPACE");
  expect(t.frame()).toContain("❯ ");
  expect(t.frame()).not.toContain("host shell ·");
  await run(t, "!echo oi");
  await until(t, () => store.blocks[0]?.status === "ok");
  await t.flush();
  expect(t.frame()).toContain("$ !echo oi");
});

test("with the input focused, no block shows the focus marker", async () => {
  const t = await mount();
  await run(t, "!echo oi");
  await until(t, () => store.blocks[0]?.status === "ok");
  await t.flush();
  expect(t.frame()).not.toContain("»");
});
