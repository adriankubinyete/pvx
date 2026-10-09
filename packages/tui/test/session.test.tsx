import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, Session } from "../src/index.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
});

const historyPath = () => join(pvxHome(), "tui-history");
async function mount() {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({ registry, makeLogger, historyPath: historyPath() });
  const root = { id: "sessao", element: <Session store={store} registry={registry} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} />);
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

test("an error block offers actions; r repeats; a throwing module does not end the session", async () => {
  const t = await mount();
  await run(t, "demo greet bad");
  expect(t.frame()).toContain("[✗] falhou");
  expect(t.frame()).toContain("repetir");
  expect(t.frame()).toContain("copiar erro");
  await t.press("r");
  expect(t.frame().match(/\[✗\] falhou/g)).toHaveLength(2);
  await run(t, "throws-on-run crash");
  expect(t.frame()).toContain("kaboom");
  await run(t, "demo greet ok");
  expect(t.frame()).toContain("[✓] oi ok");
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
