import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type MachineSnap, type Registry } from "@pvx/core";
import { RGBA } from "@opentui/core";
import { expectButtonsReachable, expectNoKeyboardTrap, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";
import { tokens } from "../src/theme.ts";
import { saveFavorites } from "../src/palette/favorites.ts";
import { snap } from "./machine-fixture.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  registry = createRegistry({ slots: { timeoutMs: 60 } }); // the fixture's hanging widget holds the first collection back
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
});

interface MountOpts { cols?: number; rows?: number; profile?: string; cores?: number; machine?: Partial<MachineSnap>; sessionIp?: string }

async function mount(opts: MountOpts = {}) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: { PVX_PROFILE: "main" }, isRoot: true, registry, makeLogger, profilesDir: join(fixtures, "profiles"), version: "0.1.0", theme }, argv),
  });
  const sampler = { sample: () => snap(opts.cores ?? 8, opts.machine) };
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} profile={opts.profile} sampler={sampler} session={{ sshClient: opts.sessionIp }} /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  return { t: h, store };
}

const lines = (t: TuiHarness) => t.frame().split("\n");
/** The numbers of the sections that carry the `▌` gutter: the active one. */
const activeSections = (t: TuiHarness) => lines(t).flatMap((line) => /▌ (\d) /.exec(line)?.[1] ?? []);
const BAR = "tab próxima aba";

test("Início at 120x40 has the machine block, the sections and the footer, and 80x24 keeps the same content in one column", async () => {
  const { t } = await mount({ cols: 120, rows: 40, profile: "Principal" });
  const f = t.frame();
  for (const s of ["central-sp-01", "Rocky Linux 8.10 · ligado há 41d 0h", "cpu ", "39%", "8 núcleos · carga  2,1  1,8  1,3", "memória", "3,1 de 6 GB", "disco /", "38 de 54 GB", "swap", "0,0 de 2 GB", "rede", "↓   1,2 MB/s", "1 Atenção", "perfil: Principal", "2 Atividade", "pvx 0.1.0"]) expect(f, s).toContain(s);
  t.destroy();

  const small = await mount({ cols: 80, rows: 24 });
  for (const l of lines(small.t)) expect(l.length).toBeLessThanOrEqual(80);
  for (const s of ["central-sp-01", "8 núcleos", "memória", "disco /", "swap", "rede", "1 Atenção", "sem perfil", "não verificado", "[ verificar ]"]) expect(small.t.frame(), s).toContain(s);
});

test("the headline is the hostname in bold and one dim line; the session IP has its own color and the product comes from the slot", async () => {
  registry.register({ id: "prod", version: "1.0.0", entry: "x" }, { widgets: { p: { slot: "home.product", priority: 0, data: () => "Issabel 5" } } });
  const { t } = await mount({ cols: 120, rows: 40, sessionIp: "198.51.100.7" });
  await Bun.sleep(200); // the first collection (the fixture's hanging widget times out at 60 ms)
  await t.flush();
  const row = lines(t).findIndex((l) => l.includes("central-sp-01"));
  expect(lines(t)[row]).toMatch(/central-sp-01 {3}Rocky Linux 8\.10 · Issabel 5 · ligado há 41d 0h · sessão 198\.51\.100\.7/);
  const spans = t.spans().lines[row]!.spans;
  const ip = spans.find((span) => span.text.includes("198.51.100.7"))!;
  expect(ip.fg.equals(RGBA.fromHex(tokens.ip))).toBe(true);
  expect(spans.find((span) => span.text.includes("central-sp-01"))!.attributes & 1).not.toBe(0); // bold
});

test("a headline too long for one row goes to a second, dim row", async () => {
  const { t } = await mount({ cols: 80, rows: 24, sessionIp: "198.51.100.7", machine: { host: "central-01", os: "Rocky Linux 8.10 (Green Obsidian)" } });
  const at = lines(t).findIndex((l) => l.includes("central-01"));
  expect(lines(t)[at]).not.toContain("Rocky");
  expect(lines(t)[at + 1]).toContain("Rocky Linux 8.10 (Green Obsidian) · ligado há 41d 0h · sessão 198.51.100.7");
});

test.each([1, 2, 4, 8, 16, 32, 64] as const)("every one of %i cores is a small meter, four per row (eight per row when many and wide)", async (cores) => {
  for (const [cols, rows] of [[80, 24], [120, 40]] as const) {
    const { t } = await mount({ cols, rows, cores });
    const coreRows = lines(t).filter((l) => /^\s{9,}\d+ [━─]+ +\d+%/.test(l));
    const perRow = cores > 8 && cols >= 120 ? 8 : 4;
    expect(coreRows, `${cores} cores at ${cols}`).toHaveLength(Math.ceil(cores / perRow));
    const text = coreRows.join("\n");
    for (let i = 0; i < cores; i++) expect(text, `core ${i}`).toMatch(new RegExp(`(^|\\s)${i} [━─]+ +\\d+%`, "m"));
    for (const l of lines(t)) expect(l.length).toBeLessThanOrEqual(cols);
    t.destroy();
  }
});

test("a core above 80% turns to the warn color; the others stay in the accent", async () => {
  const { t } = await mount({ cols: 120, rows: 40 }); // the fixture's core 5 is at 85%, core 4 at 48%
  const row = lines(t).findIndex((l) => /\s4 [━─]+ +48% +5 [━─]+ +85% +6 /.test(l));
  expect(row).toBeGreaterThan(-1);
  const bars = t.spans().lines[row]!.spans.filter((span) => span.text.includes("━"));
  expect(bars.map((span) => span.fg.equals(RGBA.fromHex(tokens.warn)))).toEqual([false, true, false, false]); // cores 4 to 7
  expect(bars[0]!.fg.equals(RGBA.fromHex(tokens.accent))).toBe(true);
});

test("live values keep their width when they change: the gauges end in the same cell at any use", async () => {
  const G = 2 ** 30;
  const ends: number[] = [];
  for (const used of [0.2, 2.7, 3.9]) {
    const { t } = await mount({ cols: 120, rows: 40, machine: { mem: { used: used * G, total: 4 * G }, cpu: { total: used * 10, cores: [10], load: [used, 1, 1], history: [used * 10] } } });
    const mem = lines(t).find((l) => l.includes("memória"))!;
    ends.push(mem.indexOf(" GB") + 3, lines(t).find((l) => l.includes("cpu "))!.indexOf("núcleo"));
    t.destroy();
  }
  expect(new Set(ends.filter((_, i) => i % 2 === 0)).size).toBe(1);
  expect(new Set(ends.filter((_, i) => i % 2 === 1)).size).toBe(1);
});

test("conformidade is not run on the first visit; r runs it and shows the pending items, each with its button", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).toContain("não verificado");
  expect(t.frame()).not.toContain("cap-fixture.a");
  await t.press("r");
  await t.flush();
  expect(t.frame()).toMatch(/\[✗\] cap-fixture\.a: pendente\s+\[ corrigir \]/);
  expect(t.frame()).toMatch(/\[!\] manual: sem fix\s*$/m); // no fix, no button
  expect(t.frame()).toMatch(/\[✓\] 1 capacidade em dia/);
  expect(t.frame()).toContain("[ verificar de novo ]");
  expect(store.blocks).toEqual([]);
  expect(store.history).toEqual([]);
  // the buttons of the items are one column
  const columns = lines(t).filter((l) => l.includes("[ corrigir ]")).map((l) => l.indexOf("[ corrigir ]"));
  expect(new Set(columns).size).toBe(1);
});

test("the ok line is dim, a blank row separates the content from the buttons, and the profile is on the right of the header", async () => {
  const { t } = await mount({ cols: 120, rows: 40, profile: "Principal" });
  await t.press("r");
  await t.flush();
  const all = lines(t);
  const ok = all.findIndex((l) => l.includes("capacidade em dia"));
  expect(all[ok + 1]).toMatch(/^\s+▌?\s*$/);
  expect(all[ok + 2]).toContain("[ verificar de novo ]");
  const text = t.spans().lines[ok]!.spans.find((span) => span.text.includes("capacidade em dia"))!;
  expect(text.fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
  expect(all.find((l) => l.includes("1 Atenção"))).toMatch(/1 Atenção\s+perfil: Principal\s*$/);
});

test("enter on a pending item puts its fix in the Comando input and runs nothing", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  expect(t.frame()).not.toMatch(/» /);
  await t.press("RETURN"); // enter the section
  expect(t.frame()).toMatch(/» \[✗\] cap-fixture\.a/);
  await t.press("RETURN"); // enter on the item
  expect(t.frame()).toContain("tab completa"); // Comando
  expect(t.frame()).toContain("❯ cap-fixture fix-a");
  expect(store.blocks).toEqual([]);
  await t.press("RETURN"); // the technician confirms
  await t.flush();
  expect(store.blocks.map((b) => b.line)).toEqual(["cap-fixture fix-a"]);
});

test("the actions row is one stop: ← and → choose the button, enter presses it, and `verificar` runs the check again", async () => {
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  await t.press("RETURN");
  for (let i = 0; i < 6; i++) await t.press("ARROW_DOWN"); // the items, then the actions row
  expect(t.frame().match(/» /g) ?? []).toHaveLength(0); // the buttons carry the cursor, not a row marker
  const before = store.blocks.length;
  await t.press("ARROW_LEFT"); // wraps inside the row: never leaves it
  await t.press("ARROW_RIGHT");
  await t.press("RETURN");
  await t.flush();
  expect(store.blocks.length).toBe(before); // `verificar` goes through `capture`: no block
  expect(t.frame()).toContain("[ verificar de novo ]");
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
  const { t } = await mount({ cols, rows, profile: "Principal" });
  const all = lines(t);
  const at = (s: string) => all.map((l, i) => (l.includes(s) ? i : -1)).filter((i) => i >= 0);
  expect(at("Início")).toEqual([0]);
  expect(all[0]).toContain("pvx 0.1.0");
  expect(at("1 Atenção")).toHaveLength(1);
  expect(at("perfil: Principal")).toEqual(at("1 Atenção"));
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
  expect(t.frame()).toContain("▌ 2 Atividade");
  await t.press("RETURN");
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
  await t.press("r");
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
  await t.press("r");
  await t.flush();
  await t.press("ARROW_UP"); // section level: nothing above, the bar
  expect(t.frame()).toContain(BAR);
  const y = rowY(t, "cap-fixture.b: pendente");
  const x = rowX(t, "cap-fixture.b: pendente");
  expect(tinted(t, x, y)).toBe(false);
  await t.hover(x + 2, y);
  expect(tinted(t, x, y)).toBe(true);
  expect(lines(t)[y]).toMatch(/› \[✗\] cap-fixture.b/);
  expect(t.frame()).not.toMatch(/» /); // never looks selected
  expect(t.frame()).toContain(BAR); // the focus did not move
  await t.hover(x + 2, rowY(t, "cap-fixture.c: pendente")); // the next row takes the tint
  expect(tinted(t, x, y)).toBe(false);
  expect(tinted(t, x, rowY(t, "cap-fixture.c: pendente"))).toBe(true);
  await t.hover(2, 38); // off the rows
  expect(tinted(t, x, rowY(t, "cap-fixture.c: pendente"))).toBe(false);
});

test("mouse, inside the active list: hover moves the selection (one » marker)", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  await t.press("RETURN"); // inside atenção
  expect(lines(t)[rowY(t, "cap-fixture.a: pendente")]).toMatch(/» \[✗\] cap-fixture.a/);
  await t.hover(rowX(t, "cap-fixture.c: pendente") + 2, rowY(t, "cap-fixture.c: pendente"));
  expect(lines(t)[rowY(t, "cap-fixture.c: pendente")]).toMatch(/» \[✗\] cap-fixture.c/);
  expect(t.frame().match(/» /g)).toHaveLength(1);
  await t.press("ARROW_DOWN"); // continues from the hovered row
  expect(lines(t)[rowY(t, "demo: revisar o painel")]).toMatch(/» \[!\] demo/);
});

test("mouse, bar focused: a click on a row without a fix focuses the section, goes inside and selects that row", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  await t.press("ARROW_UP");
  expect(t.frame()).toContain(BAR);
  await t.click(rowX(t, "manual: sem fix") + 2, rowY(t, "manual: sem fix")); // nothing leaves the tab
  expect(t.frame()).not.toContain(BAR);
  expect(activeSections(t)).toEqual(["1"]);
  expect(lines(t)[rowY(t, "manual: sem fix")]).toMatch(/» \[!\] manual/);
  expect(t.frame()).toContain("esc sai"); // inside
});

test("mouse: the button of an item puts its fix in the Comando; `verificar` runs the check and is a button, not a key hint", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await Bun.sleep(200); // the module widgets arrive and move the rows: measure after them
  await t.flush();
  const y = rowY(t, "[ verificar ]");
  const x = rowX(t, "[ verificar ]");
  await t.hover(x + 2, y);
  expect(spanAt(t, x + 2, y).bg.equals(RGBA.fromHex(tokens.accent))).toBe(true); // filled under the mouse
  await t.click(x + 2, y);
  await t.flush();
  expect(t.frame()).toContain("[ verificar de novo ]");
  await t.click(rowX(t, "[ corrigir ]") + 2, rowY(t, "cap-fixture.a: pendente"));
  expect(t.frame()).toContain("❯ cap-fixture fix-a");
});
