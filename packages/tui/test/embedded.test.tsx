import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, listModules, loadModules, logsDir, pvxHome, runCapture, tuiStatePath, type EmbeddedModule, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";
import { cardActions, moduleCards } from "../src/menu/cards.ts";
import { buildRoot } from "../src/menu/tree.ts";
import { snap } from "./machine-fixture.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const LABEL = "0.1.2 (dev, +alpha +beta)";

function embedded(id: string, dirty: boolean): EmbeddedModule {
  return {
    manifest: { id, version: "0.3.0", entry: "x" },
    info: { id, version: "0.3.0", source: `/work/pvx-${id}`, commit: "abc1234", dirty },
    factory: () => ({ commands: { hello: { help: "Says hello", readonly: true, run: () => {} } } }),
  };
}

/** A registry where `alpha` and `beta` are embedded, and `alpha` is also installed on disk. */
async function loadedRegistry(): Promise<Registry> {
  const usermodules = join(pvxHome(), "usermodules");
  process.env.PVX_USERMODULES = usermodules;
  mkdirSync(join(usermodules, "alpha"), { recursive: true });
  writeFileSync(join(usermodules, "alpha", "pvx-module.json"), JSON.stringify({ id: "alpha", version: "1.0.0", entry: "index.ts" }));
  writeFileSync(join(usermodules, "alpha", "index.ts"), "export default () => ({});\n");
  const registry = createRegistry();
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  await loadModules(registry, { hostVersion: "0.1.2", makeLogger, embedded: [embedded("alpha", false), embedded("beta", true)] });
  return registry;
}

async function mount(registry: Registry, cols = 120, rows = 40) {
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: LABEL, theme }, argv),
  });
  const tabs = <Tabs store={store} registry={registry} nav={createTabsNav()} version={LABEL} now={() => 1_700_000_000_000} sampler={{ sample: () => snap(8) }} />;
  h = await renderTui(<App root={{ id: "tabs", scope: "menu" as const, element: tabs }} logger={makeLogger("core")} onExit={() => {}} statePath={tuiStatePath()} />, { cols, rows });
  return h;
}

test("the tab bar tag is short: the version, dev and the count of embedded modules (Sistema lists them)", async () => {
  const t = await mount(await loadedRegistry());
  const bar = t.frame().split("\n")[0]!;
  expect(bar).toContain("pvx 0.1.2 dev +2");
  expect(bar).not.toContain("alpha");
});

test("Início shows the aviso for an installed module that lost to the embedded copy", async () => {
  const registry = await loadedRegistry();
  expect(registry.warnings).toEqual(["alpha: usando a cópia embutida no binário dev; a instalada foi ignorada"]);
  const t = await mount(registry);
  expect(t.frame()).toContain("alpha: usando a cópia embutida no binário dev; a instalada foi ignorada");
});

test("Módulos marks the embedded modules, with the commit and a star when dirty, and offers no update or removal", async () => {
  const registry = await loadedRegistry();
  const rows = await listModules(registry);
  const cards = moduleCards(buildRoot(registry, rows), registry, rows, new Set(), new Set());
  const alpha = cards.find((card) => card.name === "alpha")!;
  const beta = cards.find((card) => card.name === "beta")!;
  expect(alpha).toMatchObject({ origin: "embedded", embedded: true });
  expect(alpha.chips.map((chip) => chip.text)).toEqual(["embutido (dev)"]);
  expect(alpha.detail.parts.map((part) => part.text).join("")).toBe("alpha · embutido (dev) · abc1234");
  expect(beta.detail.parts.map((part) => part.text).join("")).toBe("beta · embutido (dev) · abc1234*");
  expect(cardActions(alpha).map((action) => action.id)).toEqual(["children"]);

  const t = await mount(registry);
  await t.press("TAB");
  const frame = t.frame();
  expect(frame).toContain("embutido (dev)");
  expect(frame).not.toContain("alpha 1.0.0"); // the installed copy has no row
});

test("Sistema lists the embedded modules in one row of the pvx section, with the commit and a star when dirty", async () => {
  const t = await mount(await loadedRegistry());
  for (let i = 0; i < 4; i++) await t.press("TAB"); // inicio > modulos > logs > comando > sistema
  await t.press("ARROW_DOWN"); // into the tab
  const frame = t.frame();
  expect(frame).toContain("embutidos     alpha abc1234 · beta abc1234*");
});

test("a release build shows no embedded row", async () => {
  const registry = createRegistry();
  const t = await mount(registry);
  for (let i = 0; i < 4; i++) await t.press("TAB");
  await t.press("ARROW_DOWN");
  expect(t.frame()).not.toContain("embutidos");
});
