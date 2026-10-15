import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { RGBA } from "@opentui/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
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
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
});

async function mount(opts: { cols?: number; rows?: number; profile?: string; cores?: number } = {}) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: { PVX_PROFILE: "main" }, isRoot: true, registry, makeLogger, profilesDir: join(fixtures, "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} profile={opts.profile} sampler={{ sample: () => snap(opts.cores ?? 8) }} /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  return { t: h, store };
}

test("Início renders the four zones at 120x40 and stays one column at 80x24", async () => {
  const { t } = await mount({ cols: 120, rows: 40, profile: "Principal" });
  const f = t.frame();
  for (const s of ["central-sp-01", "perfil Principal", "pvx 0.1.0", "atualizado", "› máquina", "─ cpu", "carga 2.14", "mem ", "disco ", "asterisk   68%", "› [1] conformidade", "› [2] atividade", "▰", "▱"]) expect(f).toContain(s);
  const row = f.split("\n").find((l) => l.includes("› máquina"))!;
  expect(row).toContain("› [1] conformidade"); // two columns
  t.destroy();

  const small = await mount({ cols: 80, rows: 24 });
  const lines = small.t.frame().split("\n");
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
  for (const s of ["sem perfil", "› máquina", "› [1] conformidade", "› [2] atividade", "─ cpu", "disco ", "atualizado 14:32:07", "não verificado", "r atualiza"]) expect(small.t.frame()).toContain(s);
  expect(lines.some((l) => l.includes("› máquina") && l.includes("› [1] conformidade"))).toBe(false);
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
  expect(t.frame()).not.toMatch(/» /);
  await t.press("RETURN"); // enter the panel
  expect(t.frame()).toMatch(/» . cap-fixture\.a/);
  await t.press("RETURN"); // enter on the item
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
  expect(t.frame()).toContain("› [1] conformidade ●");
  expect(t.frame()).not.toContain("› [2] atividade ●");
  expect(t.frame()).not.toMatch(/» /); // panel level: no item is selected
  await t.press("ARROW_DOWN"); // atividade is below, whatever the item count of conformidade
  expect(t.frame()).toContain("› [2] atividade ●");
  expect(t.frame()).not.toMatch(/» /);
  await t.press("RETURN"); // enter the panel
  expect(t.frame()).toContain("★ demo greet");
  expect(t.frame()).toMatch(/✓ demo remember\s+agora/);
  expect(t.frame()).toMatch(/» ★ demo greet/);
  await t.press("ARROW_DOWN");
  expect(t.frame()).toMatch(/» . demo remember/);
  await t.press("ESCAPE"); // back to the panel level, same panel
  await Bun.sleep(150);
  await t.flush();
  expect(t.frame()).toContain("› [2] atividade ●");
  expect(t.frame()).not.toMatch(/» /);
  await t.press("ARROW_UP"); // conformidade is above
  expect(t.frame()).toContain("› [1] conformidade ●");
  await t.press("ARROW_UP"); // nothing above: the bar
  expect(t.frame()).not.toContain("●");
  expect(t.frame()).toContain("tab próxima aba");
  await t.press("ARROW_DOWN"); // back to the panel that had the cursor
  expect(t.frame()).toContain("› [1] conformidade ●");
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

// Each fixed row (bar, panel titles, footer) must sit alone on its own line, whole.
test.each([[230, 24], [120, 40], [100, 30], [80, 24]] as const)("rows never overlap at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows, profile: "Principal" });
  const lines = t.frame().split("\n");
  const at = (s: string) => lines.map((l, i) => (l.includes(s) ? i : -1)).filter((i) => i >= 0);
  expect(at("Início")).toEqual([0]);
  expect(lines[0]).toContain("pvx 0.1.0");
  expect(at("› máquina")).toHaveLength(1);
  expect(at("› [1] conformidade")).toHaveLength(1);
  expect(at("perfil Principal")).toHaveLength(1);
  expect(at("› [2] atividade")).toHaveLength(1);
  expect(at("↑↓←→ painel")).toEqual([rows - 1]);
  expect(lines.filter((l) => l.includes("pvx 0.1.0"))).toHaveLength(1); // the version only in the bar
  expect(lines.filter((l) => l.includes("central-sp-01"))).toHaveLength(1); // the host only in máquina
});

test("below the minimum size only the notice shows (no half-drawn layout)", async () => {
  const { t } = await mount({ cols: 230, rows: 20 });
  const lines = t.frame().split("\n").filter((l) => l.trim());
  expect(lines).toEqual([expect.stringContaining("terminal pequeno")]);
});

test("spatial arrows at 120x40: → goes to the panel really on the right, ↓ to the one below even with a long list", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  await t.press("ARROW_LEFT"); // máquina
  expect(t.frame()).toContain("› máquina ●");
  await t.press("ARROW_RIGHT");
  expect(t.frame()).toContain("› [1] conformidade ●");
  await t.press("ARROW_DOWN"); // conformidade has several items; ↓ at panel level skips them
  expect(t.frame()).toContain("› [2] atividade ●");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("› [1] conformidade ●");
});

test("spatial arrows at 80x24 (stacked): → has nothing on the right, ↓ goes to atividade", async () => {
  const { t } = await mount({ cols: 80, rows: 24 });
  await t.press("ARROW_RIGHT");
  expect(t.frame().split("\n").at(-2)! + t.frame().split("\n").at(-1)!).toContain("nada aqui");
  expect(t.frame()).toContain("› [1] conformidade ●");
  await t.press("ARROW_DOWN");
  expect(t.frame()).toContain("› [2] atividade ●");
  await t.press("ARROW_UP");
  await t.press("ARROW_UP"); // máquina is above conformidade
  expect(t.frame()).toContain("› máquina ●");
});

// Each card row must end exactly at the panel's right border: `│ <row> │`.
test.each([[80, 24], [120, 40], [230, 25]] as const)("máquina card rows end at the panel border at %ix%i", async (cols, rows) => {
  const { t } = await mount({ cols, rows });
  const lines = t.frame().split("\n");
  for (const s of ["─ cpu", "─ memória · disco"]) {
    const l = lines.filter((x) => x.includes(s));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatch(new RegExp(`│ ${s}[ ─]+ │`));
  }
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(cols);
  expect(lines.filter((x) => x.includes("atualizado 14:32:07"))).toHaveLength(1);
  expect(lines.filter((x) => x.includes("› máquina"))).toHaveLength(1);
  expect(lines.filter((x) => x.includes("› [2] atividade"))).toHaveLength(1);
  expect(lines.filter((x) => /^ │ \d /.test(x)).length).toBeGreaterThanOrEqual(4); // cores are always kept
  expect(lines.filter((x) => x.includes("mem ")).length).toBeGreaterThan(0);
  expect(lines.some((x) => x.includes("disco "))).toBe(true);
});

test("priority dropping at 80x24, the full card at 120x40, the second graph row at 230x25", async () => {
  let f = (await mount({ cols: 80, rows: 24 })).t.frame();
  for (const s of ["asterisk", "eth0", "─ rede", "swap"]) expect(f).not.toContain(s);
  for (const s of ["─ cpu", "mem ", "disco ", "› [1] conformidade", "› [2] atividade"]) expect(f).toContain(s);
  h?.destroy();
  f = (await mount({ cols: 120, rows: 40 })).t.frame();
  for (const s of ["asterisk   68%", "eth0", "swap", "↓   1.2 MB/s"]) expect(f).toContain(s);
  h?.destroy();
  const wide = (await mount({ cols: 230, rows: 25 })).t.frame().split("\n");
  const cpu = wide.findIndex((l) => l.includes("─ cpu"));
  expect(wide[cpu + 1]).toContain("carga");
  expect(wide[cpu + 2]).toMatch(/│ [⠀-⣿ ]+ +│/); // the second graph row has no text
  expect(wide.filter((l) => l.includes("cron 1%"))).toHaveLength(0); // procs row dropped by height
});

test("16+ cores: four columns without the % label", async () => {
  const { t } = await mount({ cols: 120, rows: 40, cores: 32 });
  const cores = t.frame().split("\n").filter((l) => /^ │ +\d+ ▰|^ │ +\d+ ▱/.test(l));
  expect(cores).toHaveLength(8);
  expect(cores[0]!.slice(0, 58)).not.toContain("%");
});

// Mouse: hover always reacts; the selection only moves inside the active list; a click on a row focuses the panel and selects it.
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
  const y = t.frame().split("\n").findIndex((l) => l.includes(text));
  expect(y, text).toBeGreaterThan(-1);
  return y;
};
const rowX = (t: TuiHarness, text: string) => t.frame().split("\n")[rowY(t, text)]!.indexOf(text);
const BAR = "tab próxima aba";

test("mouse, bar focused: hovering a row of a list tints it (dim ›) and changes nothing else; the frame of the panel lights up", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  await t.press("ARROW_UP"); // panel level: nothing above, the bar
  expect(t.frame()).toContain(BAR);
  const y = rowY(t, "cap-fixture.b: pendente");
  const x = rowX(t, "cap-fixture.b: pendente");
  expect(tinted(t, x, y)).toBe(false);
  await t.hover(x + 2, y);
  expect(tinted(t, x, y)).toBe(true);
  expect(t.frame().split("\n")[y]).toMatch(/› ✗ cap-fixture.b/);
  expect(t.frame()).not.toMatch(/» /); // never looks selected
  expect(t.frame()).toContain(BAR); // the focus did not move
  const border = rowY(t, "[1] conformidade");
  const bx = rowX(t, "╭─› [1] conformidade") ;
  expect(spanAt(t, bx, border).fg.equals(RGBA.fromHex(tokens.dim))).toBe(true); // panel frame, one step brighter than the border
  await t.hover(x + 2, rowY(t, "cap-fixture.c: pendente")); // the next row takes the tint
  expect(tinted(t, x, y)).toBe(false);
  expect(tinted(t, x, rowY(t, "cap-fixture.c: pendente"))).toBe(true);
  await t.hover(2, 38); // off the panels
  expect(tinted(t, x, rowY(t, "cap-fixture.c: pendente"))).toBe(false);
  expect(spanAt(t, bx, border).fg.equals(RGBA.fromHex(tokens.border))).toBe(true);
});

test("mouse: the frame lights up with the mouse anywhere in a panel, even on an empty area, and never takes the accent", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("ARROW_UP");
  const top = rowY(t, "[2] atividade");
  const bx = rowX(t, "╭─› [2] atividade");
  expect(spanAt(t, bx, top).fg.equals(RGBA.fromHex(tokens.border))).toBe(true);
  await t.hover(60, top + 6); // empty area of atividade
  expect(spanAt(t, bx, top).fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
  expect(t.frame()).toContain(BAR);
  await t.hover(10, rowY(t, "central-sp-01")); // máquina has no rows: the panel itself
  expect(spanAt(t, bx, top).fg.equals(RGBA.fromHex(tokens.border))).toBe(true);
  expect(spanAt(t, 1, rowY(t, "› máquina")).fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
});

test("mouse, inside the active list: hover moves the selection (one » marker)", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  await t.press("RETURN"); // inside conformidade
  const a = rowY(t, "cap-fixture.a: pendente");
  expect(t.frame().split("\n")[a]).toMatch(/» ✗ cap-fixture.a/);
  await t.hover(rowX(t, "cap-fixture.c: pendente") + 2, rowY(t, "cap-fixture.c: pendente"));
  expect(t.frame().split("\n")[rowY(t, "cap-fixture.c: pendente")]).toMatch(/» ✗ cap-fixture.c/);
  expect(t.frame().match(/» /g)).toHaveLength(1);
  await t.press("ARROW_DOWN"); // continues from the hovered row
  expect(t.frame().split("\n")[rowY(t, "demo: revisar o painel")]).toMatch(/» ▲ demo/);
});

test("mouse, bar focused: a click on a row focuses the panel, goes inside and selects that row", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("r");
  await t.flush();
  await t.press("ARROW_UP");
  expect(t.frame()).toContain(BAR);
  const y = rowY(t, "fine: em ordem"); // a row without a fix: nothing leaves the tab
  await t.click(rowX(t, "fine: em ordem") + 2, y);
  expect(t.frame()).not.toContain(BAR);
  expect(t.frame()).toContain("› [1] conformidade ●");
  expect(t.frame().split("\n")[rowY(t, "fine: em ordem")]).toMatch(/» ✓ fine/);
  expect(t.frame()).toContain("esc sai"); // inside
});

test("mouse: clicking `r verifica` runs the check; `r atualiza` is underlined on hover", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.hover(5, 15); // the first re-render adds the chips line (the slots tick): measure the rows after it
  await t.flush();
  const y = rowY(t, "não verificado · r verifica");
  const x = rowX(t, "r verifica");
  expect(spanAt(t, x, y).attributes & 8).toBe(0);
  await t.hover(x + 2, y);
  expect(spanAt(t, x, y).attributes & 8).not.toBe(0);
  expect(spanAt(t, x - 4, y).attributes & 8).toBe(0); // only the action
  await t.click(x + 2, y);
  await t.flush();
  expect(t.frame()).toMatch(/1 de 5/);
  expect(t.frame()).toMatch(/verificado às \d\d:\d\d · r atualiza/);
  const y2 = rowY(t, "r atualiza");
  await t.hover(rowX(t, "r atualiza") + 2, y2);
  expect(spanAt(t, rowX(t, "r atualiza"), y2).attributes & 8).not.toBe(0);
});
