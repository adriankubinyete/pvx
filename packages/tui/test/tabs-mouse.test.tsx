import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, logsDir, pvxHome, runCapture, tuiStatePath } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const BAR_FOOTER = "↓/enter entra na aba";
const SESSION_FOOTER = "digite um comando";

/** Opens the app on Início with the tab bar focused. */
async function mount() {
  const registry = createRegistry();
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={tuiStatePath()} />, { cols: 120, rows: 40 });
  await h.press("TAB");
  await h.press("ARROW_LEFT"); // back on Início, bar focused
  expect(h.frame()).toContain(BAR_FOOTER);
  return h;
}
const goBar = async (t: TuiHarness, n: number) => {
  for (let i = 0; i < n; i++) await t.press("TAB");
};
const NL = String.fromCharCode(10);
const labelAt = (t: TuiHarness, label: string) => t.frame().split("\n")[0]!.indexOf(label) + 1;

test("Comando: with the bar focused, a click on the input focuses it and typing goes in", async () => {
  const t = await mount();
  await goBar(t, 3); // inicio > modulos > logs > comando
  expect(t.frame()).toContain(BAR_FOOTER);
  const lines = t.frame().split("\n");
  const y = lines.findIndex((l) => l.includes(SESSION_FOOTER));
  expect(y).toBeGreaterThan(0);
  await t.click(lines[y]!.indexOf(SESSION_FOOTER) + 2, y);
  expect(t.frame()).not.toContain(BAR_FOOTER);
  await t.type("ola");
  expect(t.frame()).toContain("ola");
});

// Logs has nothing to select (down on its bar says "nada aqui"), so a click there leaves the bar focused like the keyboard does.
test("a click inside Início and Sistema content moves the keyboard into the tab", async () => {
  for (const n of [0, 4]) { // inicio, sistema
    const t = await mount();
    await goBar(t, n);
    expect(t.frame()).toContain(BAR_FOOTER);
    await t.click(60, 20);
    expect(t.frame(), `tab ${n}`).not.toContain(BAR_FOOTER);
    t.destroy();
  }
});

test("a click on a tab label still switches tab and keeps the bar focused", async () => {
  const t = await mount();
  await t.click(labelAt(t, "Sistema") + 1, 0);
  const f = t.frame();
  expect(f).toContain(BAR_FOOTER);
  expect(f).toContain("aparência");
});

/** Click inside a Início section, on the blank row under its header. */
const clickSection = async (t: TuiHarness, title: string) => {
  const lines = t.frame().split("\n");
  const y = lines.findIndex((l) => l.includes(title));
  expect(y).toBeGreaterThan(-1);
  await t.click(lines[y]!.indexOf(title) + 4, y);
};
/** The numbers of the sections that carry the `▌` gutter: the active one. */
const focusedPanels = (t: TuiHarness) => t.frame().split("\n").flatMap((l) => /▌ (\d) /.exec(l)?.[1] ?? []);

test("Início, bar focused: a click on section 1 focuses section 1 (not the last one, section 2)", async () => {
  const t = await mount();
  await t.press("ARROW_DOWN");
  await t.press("2"); // section 2 is the last focused
  await t.press("ARROW_UP");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain(BAR_FOOTER);
  await clickSection(t, "1 Atenção");
  expect(t.frame()).not.toContain(BAR_FOOTER);
  expect(focusedPanels(t)).toEqual(["1"]);
});

test("Início, tab focused on section 2: a click on section 1 moves the focus to section 1", async () => {
  const t = await mount();
  await t.press("ARROW_DOWN");
  await t.press("2");
  expect(focusedPanels(t)).toEqual(["2"]);
  await clickSection(t, "1 Atenção");
  expect(focusedPanels(t)).toEqual(["1"]);
  await clickSection(t, "2 Atividade");
  expect(focusedPanels(t)).toEqual(["2"]);
});

test("Comando: with the bar focused, hovering a block still tints it and a click focuses the block", async () => {
  const t = await mount();
  await goBar(t, 3);
  const lines = t.frame().split(NL);
  await t.click(lines[lines.findIndex((l) => l.includes(SESSION_FOOTER))]!.indexOf(SESSION_FOOTER) + 2, lines.findIndex((l) => l.includes(SESSION_FOOTER)));
  await t.type("version");
  await t.press("RETURN");
  await t.flush();
  await t.press("ESCAPE");
  await t.press("ESCAPE"); // last block, then the bar
  expect(t.frame()).toContain(BAR_FOOTER);
  const y = t.frame().split(NL).findIndex((l) => l.includes("❯ version"));
  expect(y).toBeGreaterThan(0);
  await t.hover(8, y);
  expect(t.frame()).toContain("› version"); // hover cue while the bar owns the keyboard
  expect(t.frame()).toContain(BAR_FOOTER);
  await t.click(8, y);
  expect(t.frame()).not.toContain(BAR_FOOTER);
  expect(t.frame()).toContain("» version");
});
