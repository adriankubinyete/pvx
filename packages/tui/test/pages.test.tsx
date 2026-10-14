import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { ReactNode } from "react";
import { createLogger, createRegistry, loadModules, loadTuiState, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { writeFileSync } from "node:fs";
import { gotoCard } from "./cards-helpers.ts";
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
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={store} registry={reg} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
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

// The SDK components return `unknown`; typed loosely so the test can use JSX.
const { Panel, Text } = ui as unknown as Record<"Panel" | "Text", (p: Record<string, unknown>) => ReactNode>;

/** Two stacked panels on the Início rule: ↑ on the top one goes to the tab bar; esc leaves "inside" through `useBack`. */
function stackedRegistry(back: "leave" | "none", calls: string[]) {
  function Stacked() {
    const p = ui.usePanels();
    const [panel, setPanel] = ui.useState("b");
    const [inside, setInside] = ui.useState(false);
    ui.useKey("↑", "sobe", () => {
      const st = p.step({ panel, inside: false }, "up", () => 1);
      if (st?.bar) p.toBar();
      else if (st) setPanel(st.panel);
    });
    ui.useKey("enter", "entra", () => setInside(true));
    ui.useBack(back === "leave" && inside ? () => (calls.push("leave"), setInside(false)) : undefined);
    return (
      <>
        <Panel title="A" panelRef={p.ref("a")}><Text>a</Text></Panel>
        <Panel title="B" panelRef={p.ref("b")}><Text>{`panel=${panel} inside=${inside}`}</Text></Panel>
      </>
    );
  }
  const reg = createRegistry();
  reg.register({ id: "stk", version: "1.0.0", entry: "x" }, { pages: { stacked: { title: "Pilha", tab: true, render: () => <Stacked /> } } });
  return reg;
}

test("usePanels().toBar: ↑ on the top panel of a page tab focuses the tab bar", async () => {
  const t = await mount({ registry: stackedRegistry("none", []) });
  await toDemo(t);
  await t.press("ARROW_DOWN"); // into the page
  expect(t.frame()).toContain("panel=b");
  await t.press("ARROW_UP");
  await t.waitForFrame((f) => f.includes("panel=a")); // b is below a
  await t.press("ARROW_UP");
  expect(lastLine(t)).toContain("↓/enter entra na aba");
});

test("usePageFocused: true in the tab, false once ↑ goes to the bar (toBar), true again after ↓", async () => {
  function Focus() {
    const p = ui.usePanels();
    const focused = ui.usePageFocused();
    ui.useKey("↑", "sobe", () => p.toBar());
    return <Panel title={`Foco${focused ? " ●" : ""}`}><Text>{`focused=${focused}`}</Text></Panel>;
  }
  const reg = createRegistry();
  reg.register({ id: "foc", version: "1.0.0", entry: "x" }, { pages: { focus: { title: "Foco", tab: true, render: () => <Focus /> } } });
  const t = await mount({ registry: reg });
  await toDemo(t);
  expect(t.frame()).toContain("focused=false"); // the bar owns the keys
  await t.press("ARROW_DOWN");
  await t.waitForFrame((f) => f.includes("focused=true"));
  await t.press("ARROW_UP");
  await t.waitForFrame((f) => f.includes("focused=false"));
  expect(lastLine(t)).toContain("↓/enter entra na aba");
  await t.press("ARROW_DOWN");
  await t.waitForFrame((f) => f.includes("focused=true"));
});

test("usePageFocused on a pushed page: true on top; false for the page when another screen is pushed over it", async () => {
  const seen: Record<string, boolean[]> = { a: [], b: [] };
  function Probe({ id, next }: { id: string; next?: string }) {
    const focused = ui.usePageFocused();
    const router = ui.useRouter();
    seen[id]!.push(focused);
    if (next) ui.useKey("space", "empilha", () => router.push(next));
    return <Text>{`${id} focused=${focused}`}</Text>;
  }
  const reg = createRegistry();
  reg.register({ id: "stk2", version: "1.0.0", entry: "x" }, { pages: {
    a: { title: "A", render: () => <Probe id="a" next="b" /> },
    b: { title: "B", render: () => <Probe id="b" /> },
  } });
  const t = await mount({ registry: reg });
  await t.press("k", { ctrl: true });
  await t.type("#stk2.a");
  await t.press("RETURN");
  expect(t.frame()).toContain("a focused=true");
  expect(seen.a!.every(Boolean)).toBe(true);
  const before = seen.a!.length;
  await t.press(" ");
  await t.waitForFrame((f) => f.includes("b focused=true"));
  expect(t.frame()).not.toContain("a focused"); // a is under b: not rendered, so it never draws as focused again
  expect(seen.a!.slice(before).some(Boolean)).toBe(false);
});

test("useBack(fn): esc calls fn and stays on the page; with undefined esc goes back to the bar", async () => {
  const calls: string[] = [];
  const t = await mount({ registry: stackedRegistry("leave", calls) });
  await toDemo(t);
  await t.press("ARROW_DOWN");
  await t.press("RETURN");
  expect(t.frame()).toContain("inside=true");
  await t.press("ESCAPE");
  expect(calls).toEqual(["leave"]);
  expect(t.frame()).toContain("inside=false");
  expect(lastLine(t)).not.toContain("↓/enter entra na aba"); // still on the page
  await t.press("ESCAPE"); // fn undefined now: the default
  expect(lastLine(t)).toContain("↓/enter entra na aba");
  expect(calls).toEqual(["leave"]);
});

test("useBack on a pushed page: esc calls fn first, then pops", async () => {
  const calls: string[] = [];
  function Pushed() {
    const [on, setOn] = ui.useState(true);
    ui.useBack(on ? () => (calls.push("back"), setOn(false)) : undefined);
    return <Text>{`on=${on}`}</Text>;
  }
  const reg = createRegistry();
  reg.register({ id: "psh", version: "1.0.0", entry: "x" }, { pages: { pushed: { title: "Empurrada", render: () => <Pushed /> } } });
  const t = await mount({ registry: reg });
  await t.press("k", { ctrl: true });
  await t.type("#psh.pushed");
  await t.press("RETURN");
  expect(t.frame()).toContain("on=true");
  await t.press("ESCAPE");
  expect(calls).toEqual(["back"]);
  expect(t.frame()).toContain("on=false");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("Início");
});

const barLine = (t: TuiHarness) => t.frame().split("\n")[0]!;

test("t on a module card hides its tab from the bar and shows it again; the choice is saved; the module still works", async () => {
  const t = await mount({ cols: 120, rows: 30 });
  expect(barLine(t)).toContain("Demo");
  await t.press("TAB"); // Módulos
  await t.press("ARROW_DOWN");
  await gotoCard(t, "ui-demo");
  await t.press("t");
  expect(t.frame()).toContain("✓ aba Demo oculta");
  expect(barLine(t)).not.toContain("Demo");
  expect(t.frame()).toContain("aba oculta"); // the dim chip on the card
  await t.press("RETURN");
  expect(t.frame()).toMatch(/mostrar a aba\s+— t/);
  expect(t.frame()).not.toContain("abrir a aba");
  await t.press("ESCAPE");
  await Bun.sleep(400); // the state writer is debounced
  expect(loadTuiState(join(pvxHome(), "s.json")).hiddenTabs).toEqual(["ui-demo"]);
  await t.press("k", { ctrl: true }); // hidden from the bar, not from the palette
  await t.type("#counter");
  await t.press("RETURN");
  expect(t.frame()).toContain("n = 0");
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  await t.press("t");
  expect(t.frame()).toContain("✓ aba Demo visível");
  expect(barLine(t)).toContain("Demo");
  await Bun.sleep(400);
  expect(loadTuiState(join(pvxHome(), "s.json")).hiddenTabs).toEqual([]);
});

test("the open-the-tab action goes to the module tab", async () => {
  const t = await mount({ cols: 120, rows: 30 });
  await t.press("TAB");
  await t.press("ARROW_DOWN");
  await gotoCard(t, "ui-demo");
  await t.press("RETURN");
  await t.press("RETURN"); // "abrir a aba Demo" is the first action
  expect(t.frame()).toContain("estado: off");
  expect(lastLine(t)).toContain("t alterna");
});

test("a tab hidden in the saved state is not on the bar, and the active one falls back to Módulos", async () => {
  writeFileSync(join(pvxHome(), "s.json"), JSON.stringify({ hiddenTabs: ["ui-demo"] }));
  const makeLogger = () => noopLog;
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const nav = createTabsNav();
  nav.active = pageTabs(registry)[0]!.id; // it was the active tab
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={nav} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(
    <App root={root} logger={noopLog} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />,
    { cols: 120, rows: 30 },
  );
  expect(barLine(h)).not.toContain("Demo");
  expect(h.frame()).toContain("instalados"); // Módulos
});

test("Panel onPress: a click anywhere in a panel calls it, so the page focuses the clicked panel", async () => {
  function Clickable() {
    const [panel, setPanel] = ui.useState("a");
    const focused = ui.usePageFocused();
    return (
      <Panel>
        <Panel title={`A${focused && panel === "a" ? " ●" : ""}`} onPress={() => setPanel("a")}><Text>a-body</Text></Panel>
        <Panel title={`B${focused && panel === "b" ? " ●" : ""}`} onPress={() => setPanel("b")}><Text>b-body</Text></Panel>
      </Panel>
    );
  }
  const reg = createRegistry();
  reg.register({ id: "clk", version: "1.0.0", entry: "x" }, { pages: { clickable: { title: "Clique", tab: true, render: () => <Clickable /> } } });
  const t = await mount({ registry: reg });
  await toDemo(t);
  const at = (s: string) => { const l = t.frame().split("\n"); const y = l.findIndex((x) => x.includes(s)); return [l[y]!.indexOf(s) + 1, y] as const; };
  expect(t.frame()).not.toContain("B ●");
  const [x, y] = at("b-body");
  await t.click(x, y);
  expect(t.frame()).toContain("B ●"); // the bar had the keys: the click also entered the tab
  expect(t.frame()).not.toContain("A ●");
  const [ax, ay] = at("a-body");
  await t.click(ax, ay);
  expect(t.frame()).toContain("A ●");
  expect(t.frame()).not.toContain("B ●");
});
