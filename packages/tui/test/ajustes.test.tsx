import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadTuiState, logsDir, pvxHome, runCapture, tuiStatePath } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";
import { TAB_IDS } from "../src/tabs/context.ts";
import { hexTokensFor } from "../src/theme.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

/** Opens the app on Ajustes with the keyboard inside the tab. */
async function mount(cols = 120, rows = 40) {
  const registry = createRegistry();
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={tuiStatePath()} />, { cols, rows });
  for (let i = 0; i < 4; i++) await h.press("TAB"); // inicio > modulos > logs > comando > ajustes
  await h.press("ARROW_DOWN");
  return h;
}
const bgAt = (t: TuiHarness) => t.spans().lines[0]!.spans[0]!.bg;

test("tab order: Início, Módulos, then Logs, Comando, Ajustes closing the bar", async () => {
  expect(TAB_IDS).toEqual(["inicio", "modulos", "logs", "comando", "ajustes"]);
  const t = await mount();
  await t.press("ARROW_UP", {}); // leaves the list to the bar
  const bar = t.frame().split("\n")[0]!;
  const at = ["Início", "Módulos", "Logs", "Comando", "Ajustes"].map((l) => bar.indexOf(l));
  expect(at.every((x) => x >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((x, y) => x - y));
});

test("Ajustes renders the section, the footer and the preview at 80x24 and 120x40", async () => {
  for (const [cols, rows] of [[80, 24], [120, 40]] as const) {
    const t = await mount(cols, rows);
    const f = t.frame();
    for (const l of f.split("\n")) expect(l.length).toBeLessThanOrEqual(cols);
    for (const s of ["aparência", "tema", "Escuro", "cor de destaque", "símbolos", "moldura", "linha de resultado", "prévia", "[✓]", "[!]", "[✗]", "[i]", "chip", "muda/edita"]) expect(f, s).toContain(s);
    t.destroy();
  }
});

test("Personalizado at 80x24 shows the whole token list", async () => {
  const t = await mount(80, 24);
  await t.press("ARROW_RIGHT"); // dark > light
  for (let i = 0; i < 3; i++) await t.press("ARROW_RIGHT"); // > contrast > terminal > custom
  const f = t.frame();
  for (const s of ["começar de", "bg", "thirdParty", "#0e1013"]) expect(f, s).toContain(s);
});

test("switching the theme re-renders: the background colour changes and the choice is saved", async () => {
  const t = await mount();
  const before = bgAt(t);
  await t.press("ARROW_RIGHT"); // Claro
  expect(t.frame()).toContain("Claro");
  expect(bgAt(t).equals(before)).toBe(false);
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath()).theme).toBe("light");
});

test("Terminal theme uses the terminal's own colours (no truecolor background)", async () => {
  const t = await mount();
  for (let i = 0; i < 3; i++) await t.press("ARROW_RIGHT");
  expect(t.frame()).toContain("Terminal");
  expect(bgAt(t).intent).toBe("default");
});

test("Personalizado: an edited token applies, an invalid hex is rejected inline with a nudge, it persists", async () => {
  const t = await mount();
  for (let i = 0; i < 4; i++) await t.press("ARROW_RIGHT"); // custom
  expect(t.frame()).toContain("Personalizado");
  for (let i = 0; i < 6; i++) await t.press("ARROW_DOWN"); // accent, symbols, border, result, começar de, bg
  const before = bgAt(t);
  await t.press("RETURN");
  expect(t.frame()).toContain("aplica");
  await t.press("a", { ctrl: true });
  for (let i = 0; i < 7; i++) await t.press("DELETE");
  await t.type("#zz");
  await t.press("RETURN");
  expect(t.frame()).toContain("hex inválido");
  expect(t.frame()).toContain("aplica"); // still editing
  await t.press("a", { ctrl: true });
  for (let i = 0; i < 3; i++) await t.press("DELETE");
  await t.type("#102030");
  await t.press("RETURN");
  expect(bgAt(t).equals(before)).toBe(false);
  expect(t.frame()).toContain("#102030");
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  const saved = loadTuiState(tuiStatePath());
  expect(saved).toMatchObject({ theme: "custom", custom: { bg: "#102030" } });
  expect(hexTokensFor("custom", saved.custom)!.bg).toBe("#102030");
});

test("Personalizado: a text token under 4.5:1 on bg shows a warning; Começar de copies another theme", async () => {
  const t = await mount();
  for (let i = 0; i < 4; i++) await t.press("ARROW_RIGHT");
  for (let i = 0; i < 5; i++) await t.press("ARROW_DOWN"); // começar de
  await t.press("ARROW_RIGHT"); // Claro
  await t.press("RETURN");
  expect(t.frame()).toContain("#f6f7f9"); // light bg copied
  expect(t.frame()).not.toContain("▲");
  await t.press("ARROW_DOWN"); // bg
  await t.press("RETURN");
  await t.press("a", { ctrl: true });
  for (let i = 0; i < 7; i++) await t.press("DELETE");
  await t.type("#000000");
  await t.press("RETURN"); // dark text on a black bg: text, dim, ... fail
  expect(t.frame()).toMatch(/▲ \d\.\d:1/);
});

test("hovering a row moves the selection: one marker, and ArrowDown continues from it", async () => {
  const t = await mount();
  const rows = () => t.frame().split("\n");
  const y = rows().findIndex((l) => l.includes("símbolos"));
  await t.hover(10, y);
  expect(rows().filter((l) => l.includes("»")).length).toBe(1);
  expect(rows()[y]).toContain("»");
  await t.press("ARROW_DOWN");
  const marked = rows().findIndex((l) => l.includes("»"));
  expect(marked).toBe(rows().findIndex((l) => l.includes("moldura")));
});
