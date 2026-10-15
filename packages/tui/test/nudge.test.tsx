import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
let session: ReturnType<typeof createSessionStore>;
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
});

async function mount(reg = registry) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry: reg, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry: reg, makeLogger, profilesDir: join(fixtures, "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={reg} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  session = store;
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry: reg }} />);
  return h;
}
const footer = (t: TuiHarness) => t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
/** The notice shows, then disappears by itself (~1.5 s). */
async function gone(t: TuiHarness, msg: string) {
  expect(footer(t)).toContain(msg);
  await Bun.sleep(1700);
  await t.flush();
  expect(footer(t)).not.toContain(msg);
}

test("↓ from the bar on a tab with nothing selectable nudges and the notice expires", async () => {
  const t = await mount();
  await t.press("TAB"); await t.press("TAB"); // Módulos, Logs
  expect(footer(t)).not.toContain("nada aqui");
  await t.press("ARROW_DOWN");
  await gone(t, "nada aqui");
});

test("↓ at the end of a list nudges; ↑ at the top goes to the bar without a notice", async () => {
  const t = await mount();
  await t.press("TAB"); await t.press("ARROW_DOWN"); // Módulos, list focused
  for (let i = 0; i < 30; i++) await t.press("ARROW_DOWN");
  await gone(t, "fim da lista");
  for (let i = 0; i < 30; i++) await t.press("ARROW_UP");
  expect(footer(t)).not.toContain("início da lista"); // the first ↑ went to the bar
  expect(footer(t)).toContain("↓/enter entra na aba");
});

/** The numbers of the sections that carry the `▌` gutter: the active one. */
const activeSections = (t: TuiHarness) => t.frame().split("\n").flatMap((l) => /▌ (\d) /.exec(l)?.[1] ?? []);

test("Início: arrows are spatial; nothing on a side nudges; the numbers jump and stay as labels", async () => {
  const t = await mount();
  expect(activeSections(t)).toEqual(["1"]);
  expect(t.frame()).toContain("2 Atividade");
  await t.press("ARROW_RIGHT"); // the sections are stacked: nothing on the right
  expect(footer(t)).toContain("nada aqui");
  await t.press("ARROW_LEFT");
  expect(footer(t)).toContain("nada aqui");
  await t.press("ARROW_DOWN");
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("RETURN"); // atividade has nothing to select
  await gone(t, "nada para selecionar");
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("1");
  expect(activeSections(t)).toEqual(["1"]);
  await t.press("2");
  expect(activeSections(t)).toEqual(["2"]);
});

test("Início: inside a section the list edges wrap without a nudge; esc leaves", async () => {
  const t = await mount();
  await session.run("demo greet");
  await session.run("demo remember");
  await t.flush();
  await t.press("1");
  await t.press("RETURN"); // the list of atenção (the module items)
  expect(footer(t)).toContain("esc sai");
  await t.press("ESCAPE");
  await t.press("2");
  await t.press("RETURN"); // the list of atividade: most recent first
  expect(t.frame()).toMatch(/» . demo remember/);
  await t.press("ARROW_UP"); // first row: wraps to the last
  expect(t.frame()).toMatch(/» . demo greet/);
  await t.press("ARROW_DOWN"); // last row: wraps to the first
  expect(t.frame()).toMatch(/» . demo remember/);
  expect(footer(t)).not.toContain("início da lista");
  expect(footer(t)).not.toContain("fim da lista");
  expect(activeSections(t)).toEqual(["2"]); // never jumped to another section
  await t.press("ESCAPE");
  await Bun.sleep(150);
  await t.flush();
  expect(footer(t)).toContain("enter abre");
});

test("`/` from the focused tab bar opens Comando", async () => {
  const t = await mount();
  await t.press("TAB"); // bar focused
  await t.press("/");
  expect(t.frame()).toContain("tab completa"); // the Comando input is focused
  await t.type("x");
  expect(t.frame()).toContain("❯ x");
});
