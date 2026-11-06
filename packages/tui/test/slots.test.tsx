import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeFrames } from "./frame-helpers.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} });
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  registry = createRegistry({ slots: { timeoutMs: 60, minRefreshMs: 20 } });
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: quiet });
});

async function mount(opts: { cols?: number; rows?: number } = {}) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  await Bun.sleep(200); // first collection and the timeout of the hanging widget
  await h.flush();
  return { t: h, store };
}

test("widgets fill their slots by priority; the throwing and the hanging ones are marked, logged, and the home still works", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  const f = t.frame();
  expect(f).toContain("[i] demo: tudo certo"); // the notices of a module are rows of Atenção
  expect(f).toContain("widget quebrou: widget-demo.boom"); // in home.chips
  expect(f).toContain("demo: revisar o painel"); // home.attention
  expect(f).toContain("widget quebrou: widget-demo.hang");
  expect(readFileSync(join(logsDir(), "core.log"), "utf8")).toMatch(/widget widget-demo\.boom quebrou: widget explodiu[\s\S]*widget widget-demo\.hang quebrou: passou de 60 ms/);
  await t.press("ARROW_DOWN"); // the home keeps responding: atividade is below
  expect(activeFrames(t)).toEqual(["2"]);
});

test("home.attention lists the module items first, then the broken widgets; enter puts the fix in the draft", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200); // the module widgets arrive
  await t.flush();
  const lines = t.frame().split("\n");
  const at = (s: string) => lines.findIndex((l) => l.includes(s));
  expect(at("demo: revisar o painel")).toBeGreaterThan(0);
  expect(at("widget quebrou: widget-demo.hang")).toBeGreaterThan(at("demo: revisar o painel"));
  await t.press("RETURN"); // enter the section
  await t.press("RETURN"); // the first row is the module item
  expect(t.frame()).toContain("❯ widget-demo read home.chips");
  expect(store.blocks).toEqual([]);
});

test("refreshMs re-renders the home through the single scheduler", async () => {
  let n = 0;
  registry.register({ id: "tick", version: "1.0.0", entry: "x" }, {
    widgets: { c: { slot: "home.chips", priority: 99, refreshMs: 100, data: () => [{ label: `tick${++n}`, level: "ok" as const }] } },
  });
  const { t } = await mount({ cols: 120, rows: 40 });
  const seen = new Set<string>();
  // refreshMs 100 leaves idle frames between ticks, so the harness flush can settle; poll until three ticks show
  for (let i = 0; i < 50 && seen.size <= 2; i++) {
    for (const m of t.frame().matchAll(/tick(\d+)/g)) seen.add(m[1]!);
    await Bun.sleep(40);
    await t.flush();
  }
  expect(seen.size).toBeGreaterThan(2);
});

test.each([[80, 40], [230, 40]] as const)("the notices of the modules are rows of Atenção, with no strip above the sections, at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows });
  const lines = t.frame().split("\n");
  expect(lines[0]).toContain("Início");
  const header = lines.findIndex((l) => /^\s*(▌ )?\s*1 Atenção/.test(l));
  const notice = lines.findIndex((l) => l.includes("[i] demo: tudo certo"));
  expect(header).toBeGreaterThan(-1);
  expect(notice).toBeGreaterThan(header); // under the header, as a row with the glyph of its level
  expect(lines.filter((l) => l.includes("demo: tudo certo"))).toHaveLength(1);
  expect(lines.some((l) => /^\s*[✓▲] /.test(l))).toBe(false); // the old strip of glyphs is gone
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(cols);
  expect(lines[rows - 1]).toContain("enter abre");
});

test("Início drops the widget items of a module whose widgets the user hid; the others stay", async () => {
  writeFileSync(join(pvxHome(), "s.json"), JSON.stringify({ hiddenWidgets: ["widget-demo"] }));
  registry.register({ id: "other", version: "1.0.0", entry: "x" }, {
    widgets: { c: { slot: "home.chips", priority: 99, data: () => [{ label: "outro-chip", level: "ok" as const }] } },
  });
  const { t } = await mount({ cols: 120, rows: 40 });
  const f = t.frame();
  expect(f).toContain("outro-chip");
  expect(f).not.toContain("demo tudo certo");
  expect(f).not.toContain("demo: revisar o painel");
  expect(f).not.toContain("widget quebrou: widget-demo"); // the broken ones of a hidden module are not reported either
});
