import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, helpFor, Tabs, theme, ui } from "../src/index.ts";
import { fitBar } from "../src/tabs/bar.ts";
import { pageTabs } from "../src/tabs/pageTabs.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const logs: string[] = [];
let registry: Registry;
const noopLog = { debug() {}, info() {}, warn() {}, error: (m: string) => void logs.push(m) };

beforeEach(async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  logs.length = 0;
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => noopLog, ui });
});

async function mount(opts: { cols?: number; rows?: number; registry?: Registry } = {}) {
  const reg = opts.registry ?? registry;
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry: reg, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry: reg, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={store} registry={reg} nav={createTabsNav()} version="0.1.0" /> };
  h = await renderTui(
    <App root={root} logger={noopLog} onExit={() => {}} statePath={join(pvxHome(), "s.json")}
      palette={{ session: store, registry: reg }} pages={{ session: store, registry: reg, makeLogger: () => noopLog }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  return h;
}
const lastLine = (t: TuiHarness) => t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
/** Tabs from Início to the module tab `Demo` (the 3rd), bar focused. */
const toDemo = async (t: TuiHarness) => { for (let i = 0; i < 2; i++) await t.press("TAB"); };

test("a page opens from the palette # scope; its useState updates on its key; the key is in the footer and in ?", async () => {
  const t = await mount();
  await t.press("k", { ctrl: true });
  await t.type("#ui-demo.counter");
  expect(t.frame()).toContain("ui-demo.counter"); // listed under the module
  await t.press("RETURN");
  expect(t.frame()).toContain("n = 0");
  expect(lastLine(t)).toContain("space soma 1");
  await t.press(" ");
  expect(t.frame()).toContain("n = 1");
  await t.press("?");
  expect(t.frame()).toContain("soma 1");
  expect(helpFor("page:ui-demo.counter").map((s) => s.keys)).toContain("space");
  await t.press("ESCAPE"); // closes help
  await t.press("ESCAPE"); // pops back to the tabs
  expect(t.frame()).toContain("Início");
});

test("#name works from the Comando input when the name is unique; an unknown page is an error block", async () => {
  const t = await mount();
  for (let i = 0; i < 4; i++) await t.press("TAB"); // Comando
  await t.press("ARROW_DOWN");
  await t.type("#counter");
  await t.press("RETURN");
  expect(t.frame()).toContain("n = 0");
  await t.press("ESCAPE");
  await t.press("ARROW_DOWN");
  await t.type("#nope");
  await t.press("RETURN");
  expect(t.frame()).toContain("página não encontrada: nope");
});

test("a command with `page` opens it after running, and the page runs its module's command through the session", async () => {
  const t = await mount();
  for (let i = 0; i < 4; i++) await t.press("TAB"); // Comando
  await t.press("ARROW_DOWN");
  await t.type("ui-demo status");
  await t.press("RETURN");
  await t.waitForFrame((f) => f.includes("status não rodou"));
  expect(t.frame()).toContain("consulta: ready"); // useQuery
  expect(lastLine(t)).toContain("s roda status");
  await t.press("s"); // the page's key runs `ui-demo status` through the session: it pushes the page again
  await t.waitForFrame((f) => f.includes("status não rodou") && !f.includes("..."));
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  await t.waitForFrame((f) => f.includes("[✓] status ok")); // both runs are in the Comando scrollback
});

test("a page tab sits after the core tabs and follows the tab focus rules; its state is kept", async () => {
  const t = await mount({ cols: 80, rows: 24 });
  expect(t.frame().split("\n")[0]).toMatch(/Módulos.*\s+Demo\s+Logs\s+Comando/);
  await toDemo(t);
  expect(t.frame()).toContain("estado: off");
  expect(lastLine(t)).toContain("↓/enter entra na aba"); // bar focused: the footer is the bar's
  await t.press("t");
  expect(t.frame()).toContain("estado: off"); // the bar has the keyboard: the page ignores its key
  await t.press("ARROW_DOWN");
  expect(lastLine(t)).toContain("t alterna"); // content focused: the footer is the page's
  await t.press("t");
  expect(t.frame()).toContain("estado: on");
  await t.press("ESCAPE"); // back to the bar
  expect(lastLine(t)).toContain("↓/enter entra na aba");
  for (let i = 0; i < 3; i++) await t.press("TAB"); // Logs, Comando, wraps to Início
  expect(t.frame()).not.toContain("estado:");
  for (let i = 0; i < 3; i++) await t.press("TAB", { shift: true }); // Comando, Logs, Demo
  await t.press("RETURN");
  expect(t.frame()).toContain("estado: on"); // kept
});

test("the page tab is gone when its module is not loaded", async () => {
  const bare = createRegistry();
  await mount({ registry: bare });
  expect(h!.frame().split("\n")[0]).not.toContain("Demo");
});

test("a page that throws returns to the previous screen with a notice; the session goes on", async () => {
  const t = await mount();
  await t.press("k", { ctrl: true });
  await t.type("#boom");
  const err = console.error;
  console.error = () => {}; // React reports the caught render error
  await t.press("RETURN");
  console.error = err;
  expect(t.frame()).toContain('tela "#ui-demo.boom" falhou: quebrou de propósito');
  expect(t.frame()).toContain("Início");
  expect(logs.join("\n")).toContain("quebrou de propósito");
  await t.press("TAB");
  expect(t.frame()).toContain("Módulos");
  await t.press("k", { ctrl: true });
  await t.type("#counter");
  await t.press("RETURN");
  expect(t.frame()).toContain("n = 0");
});

test("a module tab that throws shows the error inline and the tab bar keeps working", async () => {
  const reg = createRegistry();
  reg.register({ id: "bad", version: "1.0.0", entry: "x" }, { pages: { p: { title: "P", tab: true, render: () => { throw new Error("tab quebrou"); } } } });
  const t = await mount({ registry: reg });
  const err = console.error;
  console.error = () => {};
  for (let i = 0; i < 2; i++) await t.press("TAB");
  console.error = err;
  expect(t.frame()).toContain('página "P" falhou: tab quebrou');
  expect(logs.join("\n")).toContain("tab quebrou");
  await t.press("TAB");
  expect(t.frame()).toContain("Início");
});

test("fitBar scrolls only as needed and keeps the active tab in view", () => {
  const w = [8, 9, 14, 7, 6, 9, 8, 8, 8]; // widths in columns
  expect(fitBar(w, 0, 0, 100)).toEqual({ from: 0, to: 9 }); // all fit: no scroll
  const a = fitBar(w, 0, 0, 60);
  expect(a.from).toBe(0);
  expect(a.to).toBeLessThan(9);
  for (const active of [0, 3, 5, 8]) {
    let from = 0;
    for (const to of [active, active, 0]) {
      const r = fitBar(w, to, from, 60);
      expect(to >= r.from && to < r.to).toBe(true);
      const used = w.slice(r.from, r.to).reduce((x, y) => x + y, 0) + (r.from > 0 ? 1 : 0) + (r.to < w.length ? 1 : 0);
      expect(used).toBeLessThanOrEqual(60);
      from = r.from;
    }
  }
  expect(fitBar(w, 8, 0, 60).from).toBeGreaterThan(0);
});

test("pageTabs sorts by order, then label", () => {
  const reg = createRegistry();
  const page = (title: string, tab: boolean | { label: string; order?: number }) => ({ title, tab, render: () => null });
  reg.register({ id: "m", version: "1.0.0", entry: "x" }, { pages: { b: page("B", true), a: page("A", { label: "Zeta", order: 1 }), c: page("C", { label: "Alfa", order: 1 }), d: { title: "D", render: () => null } } });
  expect(pageTabs(reg).map((t) => t.label)).toEqual(["B", "Alfa", "Zeta"]);
});

test("the tab bar overflows at 80 columns with a › and scrolls with ←/→", async () => {
  const reg = createRegistry();
  await loadModules(reg, { hostVersion: "0.1.0", makeLogger: () => noopLog, ui });
  const tab = (label: string) => ({ title: label, tab: { label, order: 10 }, render: () => ui.h(ui.Text, null, `corpo ${label}`) });
  reg.register({ id: "extra", version: "1.0.0", entry: "x" }, { pages: { a: tab("Alfa"), b: tab("Bravo"), c: tab("Charlie"), d: tab("Delta") } });
  const t = await mount({ registry: reg, cols: 80, rows: 24 });
  const bar = () => t.frame().split("\n")[0]!;
  expect(bar()).toContain("›");
  expect(bar()).not.toContain("‹");
  for (const l of t.frame().split("\n")) expect(l.length).toBeLessThanOrEqual(80);
  await t.press("ARROW_LEFT"); // bar focus first: shift+tab focuses it and goes to the last tab
  await t.press("TAB", { shift: true });
  expect(bar()).toContain("Delta");
  expect(bar()).toContain("‹");
  expect(bar()).not.toContain("›");
  expect(bar()).toContain("pvx 0.1.0");
  await t.press("ARROW_LEFT");
  await t.press("ARROW_LEFT");
  await t.press("ARROW_LEFT");
  await t.press("ARROW_LEFT");
  expect(bar()).toContain("Alfa");
  await t.press("ARROW_RIGHT");
  expect(bar()).toContain("Bravo");
});

test("esc from a focused block goes up to the tab bar (input -> blocks -> bar); down past the last block returns to the input", async () => {
  const t = await mount();
  for (let i = 0; i < 4; i++) await t.press("TAB"); // Comando
  await t.press("ARROW_DOWN");
  await t.type("#nope");
  await t.press("RETURN");
  await t.press("ESCAPE"); // empty input: focus the last block
  expect(t.frame()).toContain("» #nope");
  expect(lastLine(t)).toContain("esc abas");
  await t.press("ARROW_DOWN"); // past the last block: input
  expect(t.frame()).not.toContain("» #nope");
  await t.press("ESCAPE");
  await t.press("ESCAPE"); // block -> bar
  expect(t.frame()).not.toContain("» #nope");
  expect(lastLine(t)).toContain("↓/enter entra na aba");
});

const openCounter = async (t: TuiHarness) => {
  await t.press("k", { ctrl: true });
  await t.type("#ui-demo.counter");
  await t.press("RETURN");
};

test("useKey: a reserved key is ignored; PageDef.keys still works and a throwing key goes to the module log", async () => {
  const t = await mount();
  await openCounter(t);
  expect(lastLine(t)).toContain("x falha"); // static key and useKey keys share the footer
  expect(lastLine(t)).toContain("space soma 1");
  expect(lastLine(t)).not.toContain("nunca"); // `esc` registered by useKey: reserved
  await t.press("x");
  expect(logs.join("\n")).toContain('tecla "x" da página "ui-demo.counter" falhou: Error: tecla quebrou');
  expect(t.frame()).toContain("n = 0"); // still on the page
  await t.press("ESCAPE"); // the host's esc, not the page's: pops
  expect(t.frame()).toContain("Início");
});

test("useKey rows are removed when the page closes: a second visit shows each key once", async () => {
  const t = await mount();
  await openCounter(t);
  await t.press("?");
  expect(t.frame()).toContain("soma 1");
  expect(t.frame()).not.toContain("nunca");
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  await openCounter(t); // a fresh mount: no duplicated rows
  expect(lastLine(t).match(/soma 1/g)).toHaveLength(1);
});

test("a pushed page shows one border: the host frame, titled › name; the root Panel adds none", async () => {
  const t = await mount();
  await openCounter(t);
  const f = t.frame();
  expect(f.split("\n").filter((l) => l.includes("╭"))).toHaveLength(1);
  expect(f.split("\n").filter((l) => l.includes("╰"))).toHaveLength(1);
  expect(f).toContain("› Contador");
  expect(f).not.toContain("› contador"); // the Panel's own title is gone
  expect(f).toContain("n = 0");
  await t.press("ESCAPE");
  await toDemo(t); // the same rule in a page tab
  await t.press("ARROW_DOWN");
  expect(t.frame().split("\n").filter((l) => l.includes("╭"))).toHaveLength(1);
});
