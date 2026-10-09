import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OutLine } from "@pvx/sdk";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCli, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, Session, theme } from "../src/index.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
});

const historyPath = () => join(pvxHome(), "tui-history");
let store: ReturnType<typeof createSessionStore>;
async function mount(size?: { cols: number; rows: number }) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  store = createSessionStore({ registry, makeLogger, historyPath: historyPath(), isRoot: true });
  const root = { id: "sessao", element: <Session store={store} registry={registry} /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    size,
  );
  return h;
}
const run = async (t: TuiHarness, line: string) => {
  await t.type(line);
  await t.press("RETURN");
  await t.flush();
};

test("type, tab-complete and run shows a ok block; ↑ and !! use the history", async () => {
  const t = await mount();
  await t.type("demo gr");
  expect(t.frame()).toContain("demo greet");
  await t.press("TAB");
  await run(t, "ana");
  expect(t.frame()).toMatch(/❯ demo greet ana\s+✓/);
  expect(t.frame()).toContain("[✓] oi ana");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("❯ demo greet ana");
  await t.press("ESCAPE");
  await run(t, "!!");
  expect(t.frame().match(/\[✓\] oi ana/g)).toHaveLength(2);
});

test("esc focuses the last block and shows its actions; r repeats; a throwing module does not end the session", async () => {
  const t = await mount();
  await run(t, "demo greet bad");
  expect(t.frame()).toContain("[✗] falhou");
  expect(t.frame()).not.toContain("l log");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("» demo greet bad");
  expect(t.frame()).toContain("r repetir");
  expect(t.frame()).toContain("c copiar");
  await t.press("r");
  expect(t.frame().match(/\[✗\] falhou/g)).toHaveLength(2);
  await run(t, "throws-on-run crash");
  expect(t.frame()).toContain("kaboom");
  await run(t, "demo greet ok");
  expect(t.frame()).toContain("[✓] oi ok");
});

test("after a failed block, plain r/l/c type into the input (cause: they used to be error-block shortcuts)", async () => {
  const t = await mount();
  await run(t, "demo greet bad");
  await t.type("reboot");
  expect(t.frame()).toContain("❯ reboot");
  expect(t.frame().match(/\[✗\] falhou/g)).toHaveLength(1); // no repeat fired
  expect(t.frame()).not.toContain("log demo");
});

test("block focus: esc picks the last block, r repeats, up moves, l opens its log and esc returns to the input", async () => {
  const t = await mount();
  await run(t, "demo greet ana");
  await run(t, "demo greet bad");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("» demo greet bad");
  await t.press("r");
  expect(t.frame().match(/\[✗\] falhou/g)).toHaveLength(2);
  expect(t.frame()).toContain("» demo greet bad"); // the focus stays on the repeated block
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("» demo greet ana");
  await t.press("l");
  expect(t.frame()).toContain("log demo");
  await t.press("ESCAPE");
  expect(t.frame()).not.toContain("» demo greet ana"); // the log unmounted the session: back in the input
  expect(t.frame()).toContain("tab completa");
  await t.type("ok");
  expect(t.frame()).toContain("❯ ok");
});

test("focused block: enter puts its line in the input, a letter types, down on the last block returns to the input", async () => {
  const t = await mount();
  await run(t, "demo greet ana");
  await t.press("ESCAPE");
  await t.press("RETURN");
  expect(t.frame()).toContain("❯ demo greet ana");
  await t.press("ESCAPE"); // clears
  await t.press("ESCAPE"); // focus
  await t.press("ARROW_DOWN");
  expect(t.frame()).not.toContain("» demo greet ana");
  await t.press("ESCAPE");
  await t.press("x");
  expect(t.frame()).toContain("❯ x");
  expect(t.frame()).not.toContain("» demo greet ana");
});

test("ctrl+k opens the palette from the log screen too", async () => {
  const t = await mount();
  await run(t, "demo greet bad");
  await t.press("ESCAPE");
  await t.press("l");
  expect(t.frame()).toContain("log demo");
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
});

test("destructive asks for confirmation: n cancels, s runs", async () => {
  const t = await mount();
  await run(t, "demo wipe");
  expect(t.frame()).toContain("confirmar `demo wipe`? s/N");
  await t.press("n");
  expect(t.frame()).toContain("cancelado");
  expect(t.frame()).not.toContain("apagado");
  await run(t, "demo wipe");
  await t.press("s");
  expect(t.frame()).toContain("[✓] apagado");
});

test("a secret typed in the modal never reaches the frame, history or logs", async () => {
  const t = await mount();
  await run(t, "demo login");
  expect(t.frame()).toContain("token:");
  await t.type("hunter2zz");
  expect(t.frame()).not.toContain("hunter2zz");
  expect(t.frame()).toContain("*********");
  await t.press("RETURN");
  await t.flush();
  expect(t.frame()).toContain("token com 9 chars");
  expect(t.frame()).not.toContain("hunter2zz");
  const files = [historyPath(), ...readdirSync(logsDir()).map((f) => join(logsDir(), f))];
  for (const f of files) expect(readFileSync(f, "utf8")).not.toContain("hunter2zz");
});

test("full flow without mouse: type, complete, run, fail, repeat, palette, queue two, run them", async () => {
  const t = await mount();
  await t.type("demo gr");
  await t.press("TAB");
  await run(t, "ok");
  expect(t.frame()).toContain("[✓] oi ok");
  await t.type("demo gr");
  await t.press("TAB");
  await run(t, "bad");
  expect(t.frame()).toContain("[✗] falhou");
  await t.press("ESCAPE");
  await t.press("r");
  expect(t.frame().match(/\[✗\] falhou/g)).toHaveLength(2);
  await t.press("ESCAPE");

  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  expect(t.frame()).toContain("enfileira"); // the palette's footer replaces the session's
  await t.type("cap-fixture fix"); // a space inside the query is typed, it does not enqueue
  expect(t.frame()).toContain("› cap-fixture fix");
  expect(t.frame()).toContain("fila vazia");
  await t.press("n", { ctrl: true });
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  await t.press("n", { ctrl: true });
  expect(t.frame()).toContain("fila (2)");
  await t.press("j", { ctrl: true }); // ctrl+enter without the kitty protocol
  await t.flush();
  expect(t.frame()).not.toContain("fila (2)"); // palette closed
  expect(t.frame()).toContain("[✓] a aplicado");
  expect(t.frame()).toContain("[✓] c aplicado");
  expect(store.blocks.map((b) => b.line).slice(-2)).toEqual(["cap-fixture fix-a", "cap-fixture fix-c"]);
});

test("a destructive command run from the palette asks through the palette's own modal", async () => {
  const t = await mount();
  await t.press("k", { ctrl: true });
  await t.type(">wipe");
  await t.press("RETURN");
  expect(t.frame()).toContain("confirmar `demo wipe`? s/N"); // would wait forever if only the palette were mounted
  await t.press("s");
  await t.flush();
  expect(t.frame()).toContain("[✓] apagado");
});

test("a running block animates its spinner with one timer, and the timer stops after", async () => {
  const t = await mount();
  await run(t, "demo wipe"); // stays running: waiting for the confirmation
  const f = () => t.frame().match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)?.[0];
  const first = f();
  await new Promise((r) => setTimeout(r, 350));
  await t.flush();
  expect(first).toBeDefined();
  expect(f()).not.toBe(first);
  await t.press("n");
  expect(f()).toBeUndefined();
});

test("layout at 80x24 and 120x40: last block, input and footer stay visible", async () => {
  for (const size of [{ cols: 80, rows: 24 }, { cols: 120, rows: 40 }]) {
    const t = await mount(size);
    for (let i = 0; i < 12; i++) await store.run(`demo greet n${i}`);
    await t.flush();
    await t.type("demo gr");
    const lines = t.frame().split("\n");
    expect(t.frame()).toContain("oi n11"); // the last block follows the input
    expect(t.frame()).not.toContain("oi n0\n");
    expect(t.frame()).toContain("❯ demo gr");
    expect(t.frame()).toContain("tab completa");
    expect(lines.filter((l) => l.trim()).at(-1)).toContain("ctrl+k palette");
    await t.press("ESCAPE");
    await t.press("?");
    expect(t.frame()).toContain("o rodapé mostra"); // the last row of the help
    expect(t.frame()).toContain("esc fecha");
    await t.press("ESCAPE");
    await t.press("k", { ctrl: true });
    expect(t.frame()).toContain("fila vazia");
    expect(t.frame().split("\n").filter((l) => l.trim()).at(-1)).toContain("enter roda");
    await t.press("ESCAPE");
    t.destroy();
  }
});

test("parity: the same line gives the same output lines through the CLI and the TUI, and the secret leaks nowhere", async () => {
  const secret = "hunter2-parity-s3cret";
  const out: string[] = [];
  const exit = await runCli({
    argv: ["echoer", "probe", "--loud", "--json"],
    env: { NO_COLOR: "1", PVX_SECRET_KEY: secret },
    isTTY: false,
    isRoot: true,
    registry,
    makeLogger: (n) => createLogger(logsDir(), n),
    profilesDir: join(pvxHome(), "profiles"),
    version: "1.0.0",
    theme,
    out: (l) => out.push(l),
  });
  const cli = JSON.parse(out.join("")) as { lines: OutLine[] };
  expect(exit).toBe(0);
  expect(cli.lines.map((l) => l.text)).toEqual([`LOUD: chave com ${secret.length} chars`, "pronto"]);

  const t = await mount();
  const frames: string[] = [];
  const see = async (f: () => Promise<void>) => (await f(), frames.push(t.frame()));
  // 1. palette form: flag by space, secret in the masked field
  await see(() => t.press("k", { ctrl: true }));
  await see(() => t.type(">echoer probe"));
  await see(() => t.press("TAB"));
  await see(() => t.press(" "));
  await see(() => t.press("TAB"));
  await see(() => t.type(secret));
  await see(() => t.press("RETURN"));
  await t.flush();
  // 2. host modal: the line carries no secret, the host asks for it
  await see(() => t.type("echoer probe --loud"));
  await see(() => t.press("RETURN"));
  await see(() => t.type(secret));
  await see(() => t.press("RETURN"));
  await t.flush();

  const blocks = store.blocks.filter((b) => b.moduleId === "echoer");
  expect(blocks).toHaveLength(2);
  for (const b of blocks) expect(b.lines.map(({ kind, text }) => ({ kind, text }))).toEqual(cli.lines);
  const files = [historyPath(), ...readdirSync(logsDir()).map((f) => join(logsDir(), f))];
  expect(files.length).toBeGreaterThan(1);
  for (const text of [...files.map((f) => readFileSync(f, "utf8")), ...frames, t.frame()]) expect(text).not.toContain(secret);
});
