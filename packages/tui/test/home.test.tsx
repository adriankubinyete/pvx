import { afterEach, beforeEach, expect, test } from "bun:test";
import { hostname } from "node:os";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";
import { saveFavorites } from "../src/palette/favorites.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
});

async function mount(opts: { cols?: number; rows?: number; profile?: string } = {}) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: { PVX_PROFILE: "main" }, isRoot: true, registry, makeLogger, profilesDir: join(fixtures, "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" profile={opts.profile} /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  return { t: h, store };
}

test("Início renders the four zones at 120x40 and stays one column at 80x24", async () => {
  const { t } = await mount({ cols: 120, rows: 40, profile: "Principal" });
  const f = t.frame();
  for (const s of [hostname().slice(0, 12), "perfil Principal", "pvx 0.1.0", "atualizado", "› máquina", "carga", "ram", "disco /", "uptime", "› conformidade", "› atividade", "▰", "▱"]) expect(f).toContain(s);
  const row = f.split("\n").find((l) => l.includes("› máquina"))!;
  expect(row).toContain("› conformidade"); // two columns
  t.destroy();

  const small = await mount({ cols: 80, rows: 24 });
  const lines = small.t.frame().split("\n");
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
  for (const s of ["sem perfil", "› máquina", "› conformidade", "› atividade", "uptime", "não verificado", "r atualiza"]) expect(small.t.frame()).toContain(s);
  expect(lines.some((l) => l.includes("› máquina") && l.includes("› conformidade"))).toBe(false);
});

test("conformidade is not run on the first visit; r runs it and shows the pending items", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).toContain("não verificado · r verifica");
  expect(t.frame()).not.toContain("cap-fixture.a");
  await t.press("r");
  await t.flush();
  expect(t.frame()).toMatch(/1 de 5/);
  expect(t.frame()).toMatch(/verificado às \d\d:\d\d · r atualiza/);
  expect(t.frame()).toContain("cap-fixture.a: pendente");
  expect(store.blocks).toEqual([]);
  expect(store.history).toEqual([]);
});

test("enter on a pending item puts its fix in the Comando input and runs nothing", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  expect(t.frame()).toMatch(/» . cap-fixture\.a/);
  await t.press("RETURN");
  expect(t.frame()).toContain("tab completa"); // Comando
  expect(t.frame()).toContain("❯ cap-fixture fix-a");
  expect(store.blocks).toEqual([]);
  await t.press("RETURN"); // the technician confirms
  await t.flush();
  expect(store.blocks.map((b) => b.line)).toEqual(["cap-fixture fix-a"]);
});

test("focus: the focused panel has the dot, left/right move between panels, up goes to the bar and hides the selection", async () => {
  saveFavorites(["demo greet"]);
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await store.run("demo remember");
  await t.flush();
  expect(t.frame()).toContain("› conformidade ●");
  expect(t.frame()).not.toContain("› atividade ●");
  await t.press("ARROW_RIGHT");
  expect(t.frame()).toContain("› atividade ●");
  expect(t.frame()).toContain("★ demo greet");
  expect(t.frame()).toMatch(/✓ demo remember\s+agora/);
  expect(t.frame()).toMatch(/» ★ demo greet/);
  await t.press("ARROW_DOWN");
  expect(t.frame()).toMatch(/» . demo remember/);
  await t.press("ARROW_UP");
  await t.press("ARROW_UP"); // first item: the bar
  expect(t.frame()).not.toMatch(/» /);
  expect(t.frame()).not.toContain("●");
  expect(t.frame()).toContain("tab próxima aba");
  await t.press("ARROW_DOWN"); // back to the panel that had the cursor
  expect(t.frame()).toContain("› atividade ●");
  await t.press("RETURN");
  expect(t.frame()).toContain("❯ demo greet");
});

// Each fixed row (bar, panel titles, footer) must sit alone on its own line, whole.
test.each([[230, 24], [120, 40], [100, 30], [80, 24]] as const)("rows never overlap at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows, profile: "Principal" });
  const lines = t.frame().split("\n");
  const at = (s: string) => lines.map((l, i) => (l.includes(s) ? i : -1)).filter((i) => i >= 0);
  expect(at("Início")).toEqual([0]);
  expect(lines[0]).toContain("pvx 0.1.0");
  expect(at("› máquina")).toHaveLength(1);
  expect(at("› conformidade")).toHaveLength(1);
  expect(at("perfil Principal")).toHaveLength(1);
  expect(at("› atividade")).toHaveLength(1);
  expect(at("↑↓ move")).toEqual([rows - 1]);
  expect(lines.filter((l) => l.includes("pvx 0.1.0"))).toHaveLength(1); // the version only in the bar
  expect(lines.filter((l) => l.includes(hostname().slice(0, 12)))).toHaveLength(1); // the host only in máquina
});

test("below the minimum size only the notice shows (no half-drawn layout)", async () => {
  const { t } = await mount({ cols: 230, rows: 20 });
  const lines = t.frame().split("\n").filter((l) => l.trim());
  expect(lines).toEqual([expect.stringContaining("terminal pequeno")]);
});
