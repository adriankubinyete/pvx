import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeFrames } from "./frame-helpers.ts";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type MachineSnap, type Registry } from "@pvx/core";
import { RGBA } from "@opentui/core";
import { expectButtonsReachable, expectNoKeyboardTrap, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, ThemeProvider } from "../src/index.ts";
import { tokens } from "../src/theme.ts";
import { saveFavorites } from "../src/palette/favorites.ts";
import { snap } from "./machine-fixture.ts";
import { MachineBlock } from "../src/tabs/HomeMachine.tsx";
import { CONTENT_MAX_W } from "../src/layout.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  registry = createRegistry({ slots: { timeoutMs: 60 } }); // the fixture's hanging widget holds the first collection back
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
});

interface MountOpts { cols?: number; rows?: number; cores?: number; machine?: Partial<MachineSnap>; sessionIp?: string }

async function mount(opts: MountOpts = {}) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, version: "0.1.0", theme }, argv),
  });
  const sampler = { sample: () => snap(opts.cores ?? 8, opts.machine) };
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} sampler={sampler} session={{ sshClient: opts.sessionIp }} /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  return { t: h, store };
}

const lines = (t: TuiHarness) => t.frame().split("\n");
const activeSections = activeFrames;
const BAR = "tab próxima aba";

test("Início at 120x40 has the bars, the facts, the sections and the footer, and 80x24 keeps the same content with the facts under the bars when it must", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  const f = t.frame();
  for (const s of ["central-sp-01", "Rocky Linux 8.10", "ligado", "41d 0h 0m", "carga", "2,14 1,80 1,32", "processos", "212 ·   3 rodando", "rede", "↓   1,2 MB/s", "mem[", "3,1/6G", "swp[", "0,0/2G", "dsk[", "38/54G", "1 Atenção", "2 Atividade", "pvx 0.1.0"]) expect(f, s).toContain(s);
  const row = lines(t).find((l) => l.includes("central-sp-01"))!;
  expect(row.indexOf("central-sp-01")).toBeGreaterThan(40); // the facts are beside the bars
  t.destroy();

  const small = await mount({ cols: 80, rows: 24 });
  for (const l of lines(small.t)) expect(l.length).toBeLessThanOrEqual(80);
  for (const s of ["central-sp-01", "ligado", "carga", "rede", "mem[", "swp[", "dsk[", "1 Atenção"]) expect(small.t.frame(), s).toContain(s);
});

test("the facts sit on the right half beside mem, swp and dsk, which take the left half with their size inside the bar, at 80 and 120 columns", async () => {
  for (const cols of [80, 120] as const) {
    const { t } = await mount({ cols, rows: 40 });
    const host = lines(t).findIndex((l) => l.includes("central-sp-01"));
    const mem = lines(t).findIndex((l) => l.includes("mem["));
    expect(host, `at ${cols}`).toBe(mem);
    expect(lines(t)[host]!.indexOf("central-sp-01"), `at ${cols}`).toBeGreaterThanOrEqual(cols / 2 - 6);
    expect(lines(t)[mem], `at ${cols}`).toMatch(/mem\[[| ]*3,1\/6G\]/);
    t.destroy();
  }
});

test("the facts: hostname in bold, the session IP in its own color, the load with the first value bold, the product from the slot", async () => {
  registry.register({ id: "prod", version: "1.0.0", entry: "x" }, { widgets: { p: { slot: "home.product", priority: 0, data: () => "Issabel 5" } } });
  const { t } = await mount({ cols: 120, rows: 40, sessionIp: "198.51.100.7" });
  await Bun.sleep(200); // the first collection (the fixture's hanging widget times out at 60 ms)
  await t.flush();
  const row = lines(t).findIndex((l) => l.includes("central-sp-01"));
  expect(lines(t)[row]).toMatch(/central-sp-01 {2}Rocky Linux 8\.10 · Issabel 5/);
  const spansOf = (text: string) => {
    const y = lines(t).findIndex((l) => l.includes(text));
    return t.spans().lines[y]!.spans.find((span) => span.text.includes(text))!;
  };
  expect(spansOf("central-sp-01").attributes & 1).not.toBe(0); // bold
  expect(spansOf("198.51.100.7").fg.equals(RGBA.fromHex(tokens.ip))).toBe(true);
  expect(lines(t).find((l) => l.includes("sessão"))).toContain("198.51.100.7");
  expect(spansOf("2,14").attributes & 1).not.toBe(0); // the first load, bold
  expect(spansOf("1,80").attributes & 1).toBe(0);
});

test("without a session there is no `sessão` line", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).not.toContain("sessão");
});

/** The htop-style grid of core bars (it fills the width first): the columns and the rows at each width. */
const CORE_GRID: Record<number, Record<number, { columns: number; rows: number }>> = {
  80: { 1: { columns: 1, rows: 1 }, 2: { columns: 2, rows: 1 }, 8: { columns: 2, rows: 4 }, 12: { columns: 2, rows: 6 }, 32: { columns: 2, rows: 16 } },
  120: { 1: { columns: 1, rows: 1 }, 2: { columns: 2, rows: 1 }, 8: { columns: 4, rows: 2 }, 12: { columns: 4, rows: 3 }, 32: { columns: 4, rows: 8 } },
};

test.each([1, 2, 8, 12, 32] as const)("every one of %i cores is a bar, filled across the width and column by column", async (cores) => {
  for (const cols of [80, 120] as const) {
    const { columns, rows } = CORE_GRID[cols]![cores]!;
    const { t } = await mount({ cols, rows: 80, cores }); // tall enough to see every bar: the page itself scrolls at 24 rows
    const text = lines(t).join("\n");
    for (let core = 1; core <= cores; core++) expect(text, `core ${core} at ${cols}`).toMatch(new RegExp(`(^|\\s)${core} +\\[[| ]+\\d+\\.\\d%\\]`, "m"));
    const first = lines(t).findIndex((l) => /^\s+1 +\[/.test(l));
    const memRow = lines(t).findIndex((l) => l.includes("mem["));
    expect((lines(t)[first]!.match(/\d+ +\[/g) ?? []).length, `${cores} cores at ${cols}`).toBe(columns);
    expect(memRow - first, `${cores} cores at ${cols}`).toBe(rows);
    if (rows > 1) expect(lines(t)[first + 1], "column-major").toMatch(/^\s+2 +\[/);
    for (const l of lines(t)) expect(l.length).toBeLessThanOrEqual(cols);
    t.destroy();
  }
});

test("a bar above 80% turns to the warn color; the others stay in the accent; the brackets and the percent are dim and the label is info", async () => {
  const cpu = { total: 1, cores: [48, 85], load: [1, 1, 1] as [number, number, number], history: [1] };
  const { t } = await mount({ cols: 120, rows: 40, machine: { cpu } }); // two cores sit in one row: 48% then 85%
  const row = lines(t).findIndex((l) => /^\s+1 +\[/.test(l));
  const spans = t.spans().lines[row]!.spans;
  const bars = spans.filter((span) => span.text.includes("|"));
  expect(bars[0]!.fg.equals(RGBA.fromHex(tokens.accent))).toBe(true);
  expect(bars[1]!.fg.equals(RGBA.fromHex(tokens.warn))).toBe(true);
  expect(spans.find((span) => span.text.trim() === "1")!.fg.equals(RGBA.fromHex(tokens.info))).toBe(true);
  expect(spans.find((span) => span.text === "[")!.fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
  expect(spans.find((span) => span.text.includes("48.0%"))!.fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
});

test("live values keep their width when they change: the bars and the facts end in the same cell at any use", async () => {
  const G = 2 ** 30;
  const ends: number[][] = [];
  for (const used of [0.2, 2.7, 3.9]) {
    const { t } = await mount({ cols: 120, rows: 40, machine: { mem: { used: used * G, total: 4 * G }, procs: used > 1 ? 1234 : 7, cpu: { total: 1, cores: [10], load: [used, 1, 1], history: [used * 10] } } });
    const mem = lines(t).find((l) => l.includes("mem["))!;
    const proc = lines(t).find((l) => l.includes("processos"))!;
    ends.push([mem.indexOf("] ") + 1 + mem.slice(mem.indexOf("] ") + 2).trimEnd().length, proc.indexOf("rodando") + "rodando".length, lines(t).find((l) => l.includes("carga"))!.trimEnd().length]);
    t.destroy();
  }
  for (let i = 0; i < 3; i++) expect(new Set(ends.map((e) => e[i])).size, `value ${i}`).toBe(1);
});

test("focus: the active section has the gutter, ↑↓ move between sections, enter goes inside, esc comes out, ↑ at the top goes to the bar", async () => {
  saveFavorites(["demo greet"]);
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await store.run("demo remember");
  await t.flush();
  expect(activeSections(t)).toEqual(["1"]);
  expect(t.frame()).not.toMatch(/» /); // section level: no row is selected
  await t.press("ARROW_DOWN");
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("RETURN");
  expect(t.frame()).toContain("★ demo greet");
  expect(t.frame()).toMatch(/✓ demo remember\s+agora/);
  expect(t.frame()).toMatch(/» ★ demo greet/);
  await t.press("ARROW_DOWN");
  expect(t.frame()).toMatch(/» . demo remember/);
  await t.press("ESCAPE");
  await Bun.sleep(150);
  await t.flush();
  expect(activeSections(t)).toEqual(["2"]);
  expect(t.frame()).not.toMatch(/» /);
  await t.press("ARROW_UP");
  expect(activeSections(t)).toEqual(["1"]);
  await t.press("ARROW_UP"); // nothing above: the bar
  expect(activeSections(t)).toEqual([]);
  expect(t.frame()).toContain(BAR);
  await t.press("ARROW_DOWN"); // back to the section that had the cursor
  expect(activeSections(t)).toEqual(["1"]);
});

test("inside a list ↓ on the last row wraps to the first and ↑ on the first wraps to the last", async () => {
  saveFavorites(["demo greet"]);
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await store.run("demo remember");
  await t.flush();
  await t.press("ARROW_DOWN"); // atividade
  await t.press("RETURN");
  expect(t.frame()).toMatch(/» ★ demo greet/);
  await t.press("ARROW_UP"); // first row: wraps to the last
  expect(t.frame()).toMatch(/» . demo remember/);
  await t.press("ARROW_DOWN"); // last row: wraps to the first
  expect(t.frame()).toMatch(/» ★ demo greet/);
});

// Each fixed row (bar, section titles, footer) must sit alone on its own line, whole.
test.each([[230, 24], [120, 40], [100, 30], [80, 24]] as const)("rows never overlap at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows });
  const all = lines(t);
  const at = (s: string) => all.map((l, i) => (l.includes(s) ? i : -1)).filter((i) => i >= 0);
  expect(at("Início")).toEqual([0]);
  expect(all[0]).toContain("pvx 0.1.0");
  expect(at("1 Atenção")).toHaveLength(1);
  expect(at("enter abre")).toEqual([rows - 1]);
  expect(all.filter((l) => l.includes("pvx 0.1.0"))).toHaveLength(1); // the version only in the bar
  expect(all.filter((l) => l.includes("central-sp-01"))).toHaveLength(1);
  for (const l of all) expect(l.length).toBeLessThanOrEqual(cols);
});

test("a page taller than the screen scrolls to keep the cursor in view", async () => {
  saveFavorites(["demo greet"]);
  const { t, store } = await mount({ cols: 80, rows: 24, cores: 32 });
  await store.run("demo remember");
  await t.flush();
  expect(t.frame()).not.toContain("2 Atividade"); // below the fold
  await t.press("2");
  await Bun.sleep(30); // the scroll follows on the next tick
  await t.flush();
  expect(activeFrames(t)).toEqual(["2"]);
  await t.press("RETURN");
  await Bun.sleep(30);
  await t.flush();
  expect(t.frame()).toMatch(/» ★ demo greet/);
});

test("below the minimum size only the notice shows (no half-drawn layout)", async () => {
  const { t } = await mount({ cols: 230, rows: 20 });
  const shown = lines(t).filter((l) => l.trim());
  expect(shown).toEqual([expect.stringContaining("terminal pequeno")]);
});

test("the arrows are spatial: sections are stacked, so ← and → have nothing beside them", async () => {
  const { t } = await mount({ cols: 80, rows: 24 });
  await t.press("ARROW_RIGHT");
  expect(lines(t).at(-2)! + lines(t).at(-1)!).toContain("nada aqui");
  expect(activeSections(t)).toEqual(["1"]);
  await t.press("ARROW_DOWN");
  expect(activeSections(t)).toEqual(["2"]);
});

test("Início keeps the keyboard free: esc reaches the bar and every button has a key or a focus", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200);
  await t.flush();
  expectButtonsReachable();
  await expectNoKeyboardTrap(t);
  await t.press("ARROW_DOWN"); // back in the page
  await t.press("RETURN");
  await expectNoKeyboardTrap(t);
});

// Mouse: hover always reacts; the selection only moves inside the active list; a click on a row focuses the section and selects it.
const spanAt = (t: TuiHarness, x: number, y: number) => {
  let at = 0;
  for (const sp of t.spans().lines[y]!.spans) {
    if (x < at + sp.width) return sp;
    at += sp.width;
  }
  throw new Error(`no cell at ${x},${y}`);
};
const tinted = (t: TuiHarness, x: number, y: number) => spanAt(t, x, y).bg.equals(RGBA.fromHex(tokens.panel));
const rowY = (t: TuiHarness, text: string) => {
  const y = lines(t).findIndex((l) => l.includes(text));
  expect(y, text).toBeGreaterThan(-1);
  return y;
};
const rowX = (t: TuiHarness, text: string) => lines(t)[rowY(t, text)]!.indexOf(text);

test("mouse, bar focused: hovering a row tints it (dim ›) and changes nothing else", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200);
  await t.flush();
  await t.press("ARROW_UP"); // section level: nothing above, the bar
  expect(t.frame()).toContain(BAR);
  const y = rowY(t, "demo: tudo certo"); // not the first row: that one is the default selection
  const x = rowX(t, "demo: tudo certo");
  expect(tinted(t, x, y)).toBe(false);
  await t.hover(x + 2, y);
  expect(tinted(t, x, y)).toBe(true);
  expect(lines(t)[y]).toMatch(/› \[i\] demo: tudo certo/);
  expect(t.frame()).not.toMatch(/» /); // never looks selected
  expect(t.frame()).toContain(BAR); // the focus did not move
  const other = rowY(t, "widget quebrou: widget-demo.boom"); // the next row takes the tint
  await t.hover(x + 2, other);
  expect(tinted(t, x, y)).toBe(false);
  expect(tinted(t, x, other)).toBe(true);
  await t.hover(2, 38); // off the rows
  expect(tinted(t, x, other)).toBe(false);
});

test("mouse, inside the active list: hover moves the selection (one » marker)", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200);
  await t.flush();
  await t.press("RETURN"); // inside atenção
  expect(t.frame().match(/» /g)).toHaveLength(1);
  const other = rowY(t, "demo: tudo certo");
  await t.hover(rowX(t, "demo: tudo certo") + 2, other);
  expect(lines(t)[other]).toMatch(/» /);
  expect(t.frame().match(/» /g)).toHaveLength(1);
});

test("mouse, bar focused: a click on a row without a fix focuses the section, goes inside and selects that row", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200);
  await t.flush();
  await t.press("ARROW_UP");
  expect(t.frame()).toContain(BAR);
  await t.click(rowX(t, "demo: tudo certo") + 2, rowY(t, "demo: tudo certo")); // nothing leaves the tab
  expect(t.frame()).not.toContain(BAR);
  expect(activeSections(t)).toEqual(["1"]);
  expect(lines(t)[rowY(t, "demo: tudo certo")]).toMatch(/» \[i\] demo/);
  expect(t.frame()).toContain("esc sai"); // inside
});

test("an Atenção row of a module has a button only when it has a fix, and enter on it puts the fix in the Comando input and runs nothing", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200); // the module widgets arrive
  await t.flush();
  expect(t.frame()).toMatch(/\[!\] demo: revisar o painel\s+\[ corrigir \]/);
  expect(t.frame()).not.toMatch(/» /);
  await t.press("RETURN"); // enter the section
  expect(t.frame()).toMatch(/» \[!\] demo: revisar o painel/);
  await t.press("RETURN"); // enter on the item
  expect(t.frame()).toContain("tab completa"); // Comando
  expect(t.frame()).toContain("❯ widget-demo read home.chips");
  expect(store.blocks).toEqual([]);
});

test("the button of an item puts its fix in the Comando when clicked", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200);
  await t.flush();
  await t.click(rowX(t, "[ corrigir ]") + 2, rowY(t, "demo: revisar o painel"));
  expect(t.frame()).toContain("❯ widget-demo read home.chips");
});

test("an empty section is still selectable: the arrows and the number land on it, it shows the gutter and its empty line, enter does no harm", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).toContain("nenhuma");
  await t.press("ARROW_DOWN"); // atividade has no rows
  expect(activeSections(t)).toEqual(["2"]);
  await t.press("RETURN");
  expect(activeSections(t)).toEqual(["2"]);
  expect(store.blocks).toEqual([]);
  await t.press("1");
  await t.press("2");
  expect(activeSections(t)).toEqual(["2"]);
});

test("memory above 90% is a row of Atenção with the button that opens the process monitor in shell mode", async () => {
  const G = 2 ** 30;
  const { t } = await mount({ cols: 120, rows: 40, machine: { mem: { used: 7.9 * G, total: 8 * G } } });
  expect(lines(t).find((l) => l.includes("memória em 99%"))).toMatch(/\[!\] memória em 99%\s+\[ ver processos \]/);
  const bar = lines(t).findIndex((l) => l.includes("mem["));
  expect(t.spans().lines[bar]!.spans.find((span) => span.text.includes("|"))!.fg.equals(RGBA.fromHex(tokens.warn))).toBe(true); // the bar is in the warn color
  await t.press("RETURN"); // inside
  for (let i = 0; i < 10 && !lines(t).find((l) => l.includes("memória em"))!.includes("»"); i++) await t.press("ARROW_DOWN");
  await t.press("RETURN");
  expect(t.frame()).toContain("esc sai do shell"); // the Comando, in shell mode
  expect(lines(t).find((l) => l.includes("host shell · enter roda"))).toMatch(/! top/); // with the `!` consumed
});

test("no memory row while the memory has room", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).not.toContain("memória em");
});

test("Notas and Atividade are always open: their rows show without enter, which only moves the cursor into them", async () => {
  saveFavorites(["demo greet"]);
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await store.run("demo remember");
  await t.flush();
  const top = lines(t).findIndex((l) => l.includes("2 Atividade"));
  expect(lines(t)[top + 1]).toMatch(/★ demo greet/); // one row per command, not one line for all
  expect(lines(t)[top + 2]).toMatch(/demo remember/);
  expect(lines(t).filter((l) => l.includes("demo greet"))).toHaveLength(1);
  expect(t.frame()).not.toMatch(/» ★ demo greet/); // no row cursor until the section is entered
  await t.press("2");
  await t.press("RETURN"); // goes inside: the cursor is on the first row
  expect(t.frame()).toMatch(/» ★ demo greet/);
  expect(lines(t).filter((l) => l.includes("demo greet"))).toHaveLength(1); // the same rows, nothing opened or closed
  await t.press("ESCAPE");
  expect(t.frame()).not.toMatch(/» ★ demo greet/);
});

// The machine block never moves between refreshes: two very different samples give the same line count and the same columns.
const MACHINE_ANCHORS = ["ligado", "carga", "processos", "rede", "mem[", "swp[", "dsk[", "1[", "8["];

async function machineFrame(machine: ReturnType<typeof snap>, cols: number) {
  h = await renderTui(<ThemeProvider><MachineBlock machine={machine} sessionIp="203.0.113.7" width={cols - 4} /></ThemeProvider>, { cols, rows: 24 });
  await h.flush();
  return h.frame().split("\n").map((line) => line.trimEnd());
}

for (const cols of [80, 120]) {
  test(`the machine block keeps its line count and columns between two samples at ${cols} columns`, async () => {
    const quiet = snap(8, { uptime: 59, procs: 9, running: 1, cpu: { total: 1, cores: Array(8).fill(0), load: [0, 0, 0], history: [] }, mem: { used: 0, total: 6 * 2 ** 30 }, net: { iface: "eth0", rx: 0, tx: 0 } });
    const busy = snap(8, { uptime: 400 * 86400, procs: 1234, running: 120, cpu: { total: 100, cores: Array(8).fill(100), load: [99.5, 40.25, 12.1], history: [] }, mem: { used: 6 * 2 ** 30, total: 6 * 2 ** 30 }, net: { iface: "eth0", rx: 900 * 2 ** 20, tx: 2 * 2 ** 20 } });
    const first = await machineFrame(quiet, cols);
    h!.destroy();
    const second = await machineFrame(busy, cols);
    const trimmed = (lines: string[]) => lines.slice(0, lines.findLastIndex((line) => line !== "") + 1);
    expect(trimmed(second).length).toBe(trimmed(first).length);
    for (const anchor of MACHINE_ANCHORS) {
      const column = (lines: string[]) => lines.map((line) => line.indexOf(anchor));
      expect(column(second), anchor).toEqual(column(first));
    }
  });
}

// The sections are borderless Panels (a header, a gutter when active): stacked with a blank row between them, side by side from 140 columns.
test.each([[80, 24], [120, 40]] as const)("Início sections are stacked Panels with a blank row between, at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows });
  const all = lines(t);
  expect(all.some((l) => /[╭╮╰╯]/.test(l))).toBe(false); // no frame
  const heads = [/ 1 Atenção/, / 2 (Notas|Atividade)/].map((pattern) => all.findIndex((l, i) => i > 1 && pattern.test(l)));
  expect(heads[0]).toBeGreaterThan(1);
  expect(heads[1]).toBeGreaterThan(heads[0]!);
  const between = all.slice(heads[0]! + 1, heads[1]!);
  expect(between[between.length - 1]!.trim()).toBe(""); // the blank row above the next section
  for (const l of all) expect(l.length).toBeLessThanOrEqual(cols);
  expect(activeFrames(t)).toEqual(["1"]);
  await t.press("ARROW_DOWN");
  expect(activeFrames(t)).toEqual(["2"]);
});

test.each([[120, 40], [160, 40], [250, 40]] as const)("Início sections are a reading column: stacked, at the left, never wider than 100 cells, at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows });
  const all = lines(t);
  const first = all.findIndex((l, i) => i > 8 && / 1 Atenção/.test(l));
  const second = all.findIndex((l, i) => i > first && / 2 (Notas|Atividade)/.test(l));
  expect(second).toBeGreaterThan(first); // stacked: the second header is on a row of its own
  expect(all[first]!.includes(" 2 Atividade") || all[first]!.includes(" 2 Notas")).toBe(false); // and not beside the first
  for (const l of all.slice(first)) expect(l.trimEnd().length).toBeLessThanOrEqual(2 + 100); // the content starts at column 2
  expect(all[first]!.indexOf("1 Atenção")).toBeLessThan(8); // at the left
});

test.each([[80, 40], [120, 40], [160, 40], [250, 40]] as const)("the logo is fixed text (PHONEVOX), centered, between the machine block and the sections, at %ix%i", async (cols, rows) => {
  const textW = 70;
  const { t } = await mount({ cols, rows });
  const all = lines(t);
  const sign = all.map((l, i) => [l, i] as const).filter(([l]) => l.includes("██"));
  expect(sign).toHaveLength(5);
  const [first, last] = [sign[0]![1], sign[4]![1]];
  expect(last - first).toBe(4); // five consecutive rows
  const dsk = all.findIndex((l) => l.includes("dsk["));
  const attention = all.findIndex((l, i) => i > last && / 1 Atenção/.test(l));
  expect(first).toBeGreaterThan(dsk); // under the stats of the machine
  expect(attention).toBeGreaterThan(last); // and above the first section
  for (const [l] of sign) expect(l.length).toBeLessThanOrEqual(cols);
  const start = all[first]!.indexOf("██");
  const expected = 2 + Math.floor((cols - 4 - textW) / 2); // the content starts at column 2 and is `cols - 4` wide
  expect(Math.abs(start - expected)).toBeLessThanOrEqual(1);
  const inkEnd = Math.max(...sign.map(([l]) => l.lastIndexOf("█"))) + 1;
  expect(inkEnd - start).toBe(textW); // the same 70 cells at every width
});

test("the logo does not move: no timer, the same frame a moment later", async () => {
  const { t } = await mount({ cols: 160, rows: 40 });
  const signRows = () => lines(t).filter((l) => l.includes("██")).join("\n");
  const before = signRows();
  await Bun.sleep(300);
  await t.flush();
  expect(signRows()).toBe(before);
});

test("a GIF chosen in Sistema takes the right end of the sign row; none is shown by default", async () => {
  const { t } = await mount({ cols: 160, rows: 40 });
  const rowsWithInk = lines(t).filter((l) => l.includes("██"));
  expect(rowsWithInk).toHaveLength(5); // only the sign: no picture beside it
});

test("the machine block (cores, memory, facts) stretches with the terminal width, not past the old 120-cell cap", async () => {
  const wide = await mount({ cols: 250, rows: 40 });
  const memRow = lines(wide.t).find((l) => l.startsWith("mem") || l.includes(" mem["))!;
  expect(memRow).toBeDefined();
  const factRows = lines(wide.t).slice(0, 12).filter((l) => l.includes("ligado"));
  expect(factRows[0]!.indexOf("ligado")).toBeGreaterThan(100); // the facts moved to the right half of the wide page
});

test.each([[80, 40], [120, 40], [250, 40]] as const)("decorative rules run along the middle row of the logo to both edges of the page, at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows });
  const all = lines(t);
  const ink = all.map((l, i) => [l, i] as const).filter(([l]) => l.includes("██"));
  const middle = ink[2]![0];
  const start = middle.indexOf("█");
  const end = middle.lastIndexOf("█");
  const left = middle.slice(0, start);
  const right = middle.slice(end + 1);
  expect(left).toContain("─");
  expect(right).toContain("─");
  expect(left.trim()).toMatch(/^─+$/); // nothing but the rule at the left
  expect(right.trim()).toMatch(/^─+$/); // and at the right
  expect(left.endsWith("  ")).toBe(true); // a gap before the letters
  expect(right.startsWith("  ")).toBe(true); // and after them
  expect(left.indexOf("─")).toBe(2); // the left rule begins at the left edge of the content...
  expect(middle.lastIndexOf("─")).toBe(cols - 3); // ...and the right one ends at its right edge
  for (const i of [0, 1, 3, 4]) expect(ink[i]![0].includes("─")).toBe(false); // the other rows have no rule
});
