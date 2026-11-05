import { afterEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { builtin } from "../../builtin/index.ts";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, ui } from "../src/index.ts";
import { search } from "../src/palette/search.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} });
const makeLogger = (n: string) => createLogger(logsDir(), n);

/** Only the built-in modules: the fresh-server case. */
async function fresh(): Promise<Registry> {
  const empty = join(pvxHome(), "empty-usermodules");
  mkdirSync(empty, { recursive: true });
  process.env.PVX_USERMODULES = empty;
  const registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: quiet, ui, builtin });
  return registry;
}

async function mount(registry: Registry) {
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(
    <App root={root} logger={quiet()} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />,
    { cols: 120, rows: 40 },
  );
  return { t: h, store };
}

test("fresh server: core commands are listed and each prefix narrows the list", async () => {
  const registry = await fresh();
  const keys = (q: string) => search(registry, q).map((x) => x.key);
  expect(keys("")).toEqual(expect.arrayContaining(["modules", "modules search", "modules add", "logs", "version"]));
  expect(search(registry, "")[0]).toMatchObject({ core: true });
  expect(search(registry, "").some((x) => x.page)).toBe(false); // no built-in has a page
  expect(keys(">").some((k) => k.includes("."))).toBe(false); // `>`: commands only
  expect(search(registry, ">").some((x) => x.page)).toBe(false);
  expect(search(registry, "#").every((x) => x.page)).toBe(true);
  expect(search(registry, "@nucleo").every((x) => x.core)).toBe(true);
  expect(keys("!")).toEqual(["nota remove"]); // the only destructive command of a fresh server
});

test("running a core command from the palette lands in the scrollback", async () => {
  const { t, store } = await mount(await fresh());
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("comandos");
  await t.type(">version");
  await t.press("RETURN");
  await t.flush();
  expect(store.getSnapshot().blocks.map((b) => b.line)).toEqual(["version"]);
  expect(store.getSnapshot().history).toContain("version");
});

test("a core command with args shows its form", async () => {
  const { t } = await mount(await fresh());
  await t.press("k", { ctrl: true });
  await t.type(">logs");
  await t.press("ARROW_RIGHT");
  expect(t.frame()).toContain("Tail");
  expect(t.frame()).toContain("$ pvx logs");
});

test("typing `h` in the Comando input shows a block with the command listing", async () => {
  const { t, store } = await mount(await fresh());
  expect(search(await fresh(), "help").some((x) => x.core && x.key === "help")).toBe(true);
  await t.type("/"); // goes to the Comando tab
  await t.type("h");
  await t.press("RETURN");
  await t.flush();
  expect(store.getSnapshot().blocks.map((b) => b.line)).toEqual(["h"]);
  const lines = store.getSnapshot().blocks[0]!.lines.map((l) => l.text);
  expect(lines).toContain("Opções globais:");
  expect(lines).toContain("Núcleo:");
  expect(t.frame()).toContain("`!` marca comando destrutivo.");
});
