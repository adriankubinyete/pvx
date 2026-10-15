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
async function mount(o: { isRoot?: boolean; shellTimeoutMs?: number; cols?: number; rows?: number } = {}) {
  if (!h) exits = 0;
  const registry = await load();
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  store = createSessionStore({ registry, makeLogger, historyPath: join(pvxHome(), "tui-history"), isRoot: o.isRoot ?? true, shellTimeoutMs: o.shellTimeoutMs });
  h = await renderTui(
    <App root={{ id: "sessao", element: <Session store={store} registry={registry} /> }} logger={makeLogger("core")} onExit={() => void exits++} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: o.cols ?? 100, rows: o.rows ?? 24 },
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

test("the Logs tab reads the logs of every module on its own while visible and follows the end", async () => {
  const registry = await load();
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const st = createSessionStore({ registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history") });
  for (let i = 1; i <= 60; i++) makeLogger("alfa").info(`linha ${i}`);
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={st} registry={registry} nav={createTabsNav()} version="0.1.0" logsMs={60} /> };
  const t = (h = await renderTui(<App root={root} logger={{ debug() {}, info() {}, warn() {}, error() {} }} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: st, registry }} />, { cols: 100, rows: 24 }));
  await t.press("TAB");
  await t.press("TAB"); // Logs
  expect(t.frame()).toContain("linha 60"); // the end of a long log is on screen
  expect(t.frame()).not.toContain("linha 1 ");
  makeLogger("beta").info("linha de outro módulo");
  await until(t, () => t.frame().includes("linha de outro módulo"));
  expect(t.frame()).toContain("● ao vivo");
});

test("typing a core command prefix and tab completes it", async () => {
  const t = await mount();
  await t.type("modul");
  expect(t.frame()).toContain("modules");
  await t.press("TAB");
  expect(t.frame()).toContain("❯ modules ");
});

const inputRow = (t: TuiHarness) => t.frame().split("\n").find((l) => l.includes("host shell") || l.includes("tab completa"))!;

test("typing `!` first enters shell mode: the `!` is consumed, the prompt is `!`, the footer says how to leave; backspace on an empty line leaves", async () => {
  const t = await mount();
  expect(inputRow(t)).toContain("❯ ");
  await t.type("!");
  expect(inputRow(t)).toContain("! "); // the shell prompt
  expect(inputRow(t)).not.toContain("!!");
  expect(inputRow(t)).not.toContain("❯");
  expect(inputRow(t)).toContain("host shell · enter roda");
  expect(t.frame()).toContain("esc sai do shell");
  await t.type("ls");
  expect(inputRow(t)).toMatch(/! ls/);
  expect(inputRow(t)).not.toContain("!ls"); // the `!` is not part of the text
  await t.press("BACKSPACE");
  await t.press("BACKSPACE"); // the text is gone, still in shell mode
  expect(inputRow(t)).toContain("host shell");
  await t.press("BACKSPACE"); // on an empty line: back to the pvx prompt
  expect(inputRow(t)).toContain("❯ ");
  expect(t.frame()).not.toContain("host shell ·");
});

test("esc leaves shell mode and clears the line", async () => {
  const t = await mount();
  await t.type("!echo");
  expect(t.frame()).toContain("esc sai do shell");
  await t.press("ESCAPE");
  expect(inputRow(t)).toContain("❯ ");
  expect(t.frame()).not.toContain("echo");
});

test("a paste that starts with `!` enters shell mode without the `!`", async () => {
  const t = await mount();
  await t.paste("!echo colado");
  expect(inputRow(t)).toMatch(/! echo colado/);
  expect(inputRow(t)).not.toContain("!echo");
  expect(t.frame()).toContain("esc sai do shell");
  await t.press("ESCAPE");
  await t.paste("sem bang");
  expect(inputRow(t)).toContain("❯ sem bang");
});

test("submit runs the shell command; the scrollback line shows the marker `!` and the command without it, and the results start at the left margin", async () => {
  const t = await mount();
  await run(t, "!echo batata frita");
  await until(t, () => store.blocks[0]?.status === "ok");
  await t.flush();
  expect(store.blocks[0]!.line).toBe("!echo batata frita"); // the history keeps the shell mark
  const header = t.frame().split("\n").find((l) => l.includes("echo batata frita") && /\d\d:\d\d:\d\d/.test(l))!;
  expect(header).toMatch(/^ {2}\d\d:\d\d:\d\d {2}! echo batata frita/);
  expect(header).not.toContain("$");
  const result = t.frame().split("\n").find((l) => l.trim() === "batata frita")!;
  expect(result.indexOf("batata")).toBe(header.search(/\d/)); // the same column as the time
  expect(inputRow(t)).toContain("❯ "); // the mode ends with the command
});

test("↑ recalls a shell entry in shell mode, and enter on a shell block puts it back that way", async () => {
  const t = await mount();
  await run(t, "!echo um");
  await until(t, () => store.blocks[0]?.status === "ok");
  await t.press("ARROW_UP");
  expect(inputRow(t)).toMatch(/! echo um/);
  expect(t.frame()).toContain("esc sai do shell");
  await t.press("ESCAPE");
  await t.press("ESCAPE"); // empty input: the last block
  await t.press("RETURN");
  expect(inputRow(t)).toMatch(/! echo um/);
});

test("with the input focused, no block shows the focus marker", async () => {
  const t = await mount();
  await run(t, "!echo oi");
  await until(t, () => store.blocks[0]?.status === "ok");
  await t.flush();
  expect(t.frame()).not.toContain("»");
});

test.each([[80, 24], [120, 40]] as const)("Comando at %ix%i: no frame around the input, no fill on the blocks, blocks one after the other, the input at the bottom", async (cols, rows) => {
  const t = await mount({ cols, rows });
  await run(t, "!echo um");
  await until(t, () => store.blocks[0]?.status === "ok");
  await run(t, "!echo dois");
  await until(t, () => store.blocks[1]?.status === "ok");
  await t.flush();
  const all = t.frame().split("\n");
  for (const l of all) expect(l.length).toBeLessThanOrEqual(cols);
  expect(t.frame()).not.toMatch(/[╭╮╰╯]/); // the input is a field, not a box
  const first = all.findIndex((l) => l.includes("! echo um"));
  expect(all[first + 1]!.trim()).toBe("um");
  expect(all[first + 2]).toContain("! echo dois"); // no blank row between blocks
  const input = all.findLastIndex((l) => l.includes("tab completa"));
  expect(input).toBe(rows - 2); // the row above the footer
});
