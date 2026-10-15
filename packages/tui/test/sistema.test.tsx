import { afterEach, expect, test } from "bun:test";
import { RGBA, TextAttributes } from "@opentui/core";
import { join } from "node:path";
import { createLogger, createRegistry, loadTuiState, logsDir, pvxHome, runCapture, tuiStatePath } from "@pvx/core";
import { expectButtonsReachable, expectNoKeyboardTrap, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";
import { TAB_IDS } from "../src/tabs/context.ts";
import { hexTokensFor, tokens } from "../src/theme.ts";

let h: TuiHarness | undefined;
let lastStore: ReturnType<typeof createSessionStore> | undefined;
afterEach(() => h?.destroy());

/** Opens the app on Sistema with the keyboard inside the tab. */
async function mount(cols = 120, rows = 40, env: Record<string, string> = {}) {
  const registry = createRegistry();
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={tuiStatePath()} />, { cols, rows });
  for (let i = 0; i < 4; i++) await h.press("TAB"); // inicio > modulos > logs > comando > sistema
  await h.press("ARROW_DOWN");
  lastStore = store;
  return h;
}
const bgAt = (t: TuiHarness) => t.spans().lines[0]!.spans[0]!.bg;

test("tab order: Início, Módulos, then Logs, Comando, Sistema closing the bar", async () => {
  expect(TAB_IDS).toEqual(["inicio", "modulos", "logs", "comando", "sistema"]);
  const t = await mount();
  await t.press("ARROW_UP", {}); // leaves the list to the bar
  const bar = t.frame().split("\n")[0]!;
  const at = ["Início", "Módulos", "Logs", "Comando", "Sistema"].map((l) => bar.indexOf(l));
  expect(at.every((x) => x >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((x, y) => x - y));
});

test("Sistema renders its three sections and the footer at 80x24 and 120x40, each row inside the frame", async () => {
  const top = ["1 Pvx", "versão", "atualização", "[ atualizar ]", "[ verificar ]", "plataforma", "dados", "desinstalar", "sudo pvx uninstall", "2 Aparência", "tema", "[ Escuro ]", "Personalizado", "acento", "símbolos", "enter escolhe", "1-3 seção"];
  const rest = ["moldura", "resultado", "prévia", "3 Avançado", "aba Tarefas", "[ ] mostrar"];
  const wide = await mount(120, 40);
  for (const l of wide.frame().split("\n")) expect(l.length).toBeLessThanOrEqual(120);
  for (const s of [...top, ...rest]) expect(wide.frame(), s).toContain(s);
  wide.destroy();
  const narrow = await mount(80, 24);
  for (const l of narrow.frame().split("\n")) expect(l.length).toBeLessThanOrEqual(80);
  for (const s of top) expect(narrow.frame(), s).toContain(s);
  await narrow.press("3"); // the page scrolls to the row
  for (const s of ["3 Avançado", "aba Tarefas", "[ ] mostrar"]) expect(narrow.frame(), s).toContain(s);
});

test("the live preview sits beside the options from 120 columns and below them under that", async () => {
  const wide = await mount(120, 40);
  const beside = rowsOf(wide).slice(2);
  const header = beside.find((l) => l.includes("prévia"))!;
  expect(header).toContain("tema"); // on the row of the theme options
  expect(header.indexOf("prévia")).toBeGreaterThan(70);
  for (const s of ["1 Seção ativa", "2 Seção inativa", "linha selecionada", "[✓] aplicado", "[!] revise isto", "[✗] falhou", "[i] para saber mais", "[ em foco ]", "[ sem foco ]", "ATIVO", "60%", "✓ etapa"]) expect(wide.frame(), s).toContain(s);
  wide.destroy();
  const narrow = await mount(80, 24);
  for (let i = 0; i < 5; i++) await narrow.press("ARROW_DOWN"); // down to `resultado`: the page scrolls to it
  const lines = rowsOf(narrow).slice(2);
  const result = lines.findIndex((l) => l.includes("resultado"));
  const below = lines.findIndex((l) => l.includes("prévia"));
  expect(below).toBeGreaterThan(result);
  expect(lines[below]!.indexOf("prévia")).toBeLessThan(20); // under the options, not beside them
});

const rowsOf = (t: TuiHarness) => t.frame().split("\n");
/** The rows of the page that carry the cursor `»` in their marker column (the sample has its own selected row). */
const cursorRows = (t: TuiHarness) => rowsOf(t).slice(2).filter((l) => /^\s*▌?\s*»/.test(l));
/** The first row of the page with `text` (the tab bar, with `Sistema` in it, is not a row). */
const rowOf = (t: TuiHarness, text: string) => rowsOf(t).slice(2).find((l) => l.includes(text))!;
/** Walks the cursor down to the row that has `label` (the rows come in a fixed order). */
async function goTo(t: TuiHarness, label: string) {
  for (let i = 0; i < 10 && !rowOf(t, label).includes("»"); i++) await t.press("ARROW_DOWN");
  expect(rowOf(t, label)).toContain("»");
}

test("the cursor goes through the rows of every section; ↓ on the last wraps to the first; ↑ on the first goes to the bar", async () => {
  const t = await mount();
  const order = ["atualização", "tema", "acento", "símbolos", "moldura", "resultado", "aba Tarefas"];
  for (const label of order) {
    expect(rowOf(t, label), label).toContain("»");
    await t.press("ARROW_DOWN");
  }
  expect(rowOf(t, "atualização")).toContain("»"); // wrapped
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("troca aba");
});

test("the numbers jump to the first row of a section and the active section carries the gutter", async () => {
  const t = await mount();
  await t.press("2");
  expect(rowOf(t, "tema")).toContain("»");
  expect(rowOf(t, "2 Aparência")).toContain("▌");
  await t.press("3");
  expect(rowOf(t, "aba Tarefas")).toContain("»");
  expect(rowOf(t, "3 Avançado")).toContain("▌");
  await t.press("1");
  expect(rowOf(t, "atualização")).toContain("»");
});

test("switching the theme re-renders: the background colour changes and the choice is saved", async () => {
  const t = await mount();
  await goTo(t, "tema");
  const before = bgAt(t);
  await t.press("ARROW_RIGHT"); // Claro
  expect(rowOf(t, "tema")).toContain("[ Claro ]");
  expect(bgAt(t).equals(before)).toBe(false);
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath()).theme).toBe("light");
});

test("Terminal theme uses the terminal's own colours (no truecolor background)", async () => {
  const t = await mount();
  await goTo(t, "tema");
  for (let i = 0; i < 3; i++) await t.press("ARROW_RIGHT");
  expect(rowOf(t, "tema")).toContain("[ Terminal ]");
  expect(bgAt(t).intent).toBe("default");
});

test("the accent picker: one ● per preset, the chosen one as `(●) name` in bold, the cursor's swatch marked before it is chosen", async () => {
  const t = await mount();
  await goTo(t, "acento");
  expect(rowOf(t, "acento")).toMatch(/\(◌\) tema {2}● {2}● {2}● {2}●/); // tema follows the theme: a dim ◌
  for (let i = 0; i < 4; i++) await t.press("ARROW_RIGHT"); // the cursor walks to the last swatch (roxo) without choosing it
  expect(rowOf(t, "acento")).toContain("(◌) tema");
  const accent = rowsOf(t).findIndex((l, i) => i > 1 && l.includes("acento"));
  const spans = () => t.spans().lines[accent]!.spans;
  const last = spans().filter((span) => span.text === "●").at(-1)!;
  expect(last.bg.equals(RGBA.fromHex(tokens.panel))).toBe(true); // the cursor's swatch has the fill
  expect(last.attributes & TextAttributes.UNDERLINE).toBeGreaterThan(0);
  expect(last.width).toBe(1); // one cell
  await t.press("RETURN"); // choose it
  expect(rowOf(t, "acento")).toMatch(/◌ {2}● {2}● {2}● {2}\(●\) roxo/);
  const chosen = spans().find((span) => span.text === "roxo")!;
  expect(chosen.attributes & TextAttributes.BOLD).toBeGreaterThan(0);
  expect(spans().find((span) => span.text === "(")!.fg.equals(RGBA.fromHex(tokens.text))).toBe(true); // brackets in the normal color
  await t.press("ARROW_RIGHT"); // the cursor wraps to `tema`, a swatch that is not the chosen one
  const follow = spans().find((span) => span.text === "◌")!;
  expect(follow.bg.equals(RGBA.fromHex(tokens.panel))).toBe(true);
  expect(follow.fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath()).accent).toBe("roxo");
});

test("the sample repaints before choosing: the swatch under the keyboard and the option under the mouse", async () => {
  const t = await mount();
  const sampleAccent = () => {
    const y = rowsOf(t).findIndex((l) => l.includes("1 Seção ativa"));
    return t.spans().lines[y]!.spans.find((span) => span.text.includes("1 Seção ativa"))!.fg;
  };
  const before = sampleAccent();
  await goTo(t, "acento");
  await t.press("ARROW_RIGHT"); // menta? the next preset: its color differs from the theme's accent only for azul, so walk on
  await t.press("ARROW_RIGHT"); // azul
  expect(sampleAccent().equals(before)).toBe(false);
  expect(rowOf(t, "acento")).toContain("(◌) tema"); // nothing was chosen
  const light = spotOf(t, "Claro");
  await t.hover(light.x + 1, light.y);
  expect(sampleAccent().equals(RGBA.fromHex(tokens.accent))).toBe(false); // the light theme has its own accent
  await t.hover(2, 38);
});

test("Avançado: the Tarefas tab checkbox starts off, enter and space toggle it, and it is saved", async () => {
  const t = await mount();
  await t.press("3");
  expect(rowOf(t, "aba Tarefas")).toContain("[ ] mostrar");
  await t.press("RETURN");
  expect(rowOf(t, "aba Tarefas")).toContain("[x] mostrar");
  await t.press(" ");
  expect(rowOf(t, "aba Tarefas")).toContain("[ ] mostrar");
  await t.press(" ");
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath()).showTasksTab).toBe(true);
});

/** Chooses the Personalizado theme: the editor takes the place of the preset options. The cursor stays on the `tema` row. */
async function chooseCustom(t: TuiHarness) {
  await goTo(t, "tema");
  for (let i = 0; i < 4; i++) await t.press("ARROW_RIGHT");
  expect(rowOf(t, "tema")).toContain("[ Personalizado ]");
}

const TOKENS = ["bg", "panel", "selected", "border", "text", "dim", "accent", "ok", "warn", "error", "info", "thirdParty", "ip"];

test("Personalizado hides the preset options and shows the editor under `tema`; a preset brings them back; the cursor stays on `tema`", async () => {
  const t = await mount();
  for (const s of ["acento", "símbolos", "moldura", "resultado"]) expect(t.frame(), s).toContain(s);
  expect(t.frame()).not.toContain("começar de");
  await chooseCustom(t);
  for (const s of ["começar de", ...TOKENS.map((token) => `${token} `), "#0e1013"]) expect(t.frame(), s).toContain(s);
  for (const s of ["acento", "símbolos", "moldura", "resultado"]) expect(t.frame(), s).not.toContain(s);
  expect(cursorRows(t).map((l) => /» (\S+)/.exec(l)![1])).toEqual(["tema"]);
  expect(t.frame()).toContain("prévia"); // the sample stays
  await t.press("ARROW_LEFT"); // Terminal: a preset again
  expect(t.frame()).not.toContain("começar de");
  for (const s of ["acento", "símbolos", "moldura", "resultado"]) expect(t.frame(), s).toContain(s);
  expect(cursorRows(t).map((l) => /» (\S+)/.exec(l)![1])).toEqual(["tema"]);
});

test("the editor at 80x24 scrolls with the cursor to the last color", async () => {
  const t = await mount(80, 24);
  await chooseCustom(t);
  for (let i = 0; i < 14; i++) await t.press("ARROW_DOWN"); // começar de and the 13 colors
  expect(cursorRows(t).map((l) => /» (\S+)/.exec(l)![1])).toEqual(["ip"]);
  expect(t.frame()).toContain("thirdParty");
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath()).theme).toBe("custom");
});

test("REGRESSION: ↓ walks every editor row in order, and on `border` goes to `text`, never back up to a select of the page", async () => {
  const t = await mount();
  await chooseCustom(t);
  const at = () => cursorRows(t).map((l) => /» (\S+)/.exec(l)![1]);
  await t.press("ARROW_DOWN");
  expect(at()).toEqual(["começar"]); // `começar de`
  for (const token of TOKENS) {
    await t.press("ARROW_DOWN");
    expect(at(), token).toEqual([token]);
    if (token === "border") {
      await t.press("ARROW_DOWN");
      expect(at()).toEqual(["text"]);
      await t.press("ARROW_UP");
      expect(at()).toEqual(["border"]);
    }
  }
  await t.press("ARROW_DOWN");
  expect(at()).toEqual(["aba"]); // `aba Tarefas`, after the last color
  await t.press("ARROW_UP");
  await t.press("ARROW_UP");
  expect(at()).toEqual(["thirdParty"]);
});

test("Personalizado: an edited token applies, an invalid hex is rejected inline with a nudge, it persists", async () => {
  const t = await mount();
  await chooseCustom(t);
  await t.press("ARROW_DOWN"); // começar de
  await t.press("ARROW_DOWN"); // bg
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

test("a pasted hex goes into the color being edited", async () => {
  const t = await mount();
  await chooseCustom(t);
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  await t.press("RETURN");
  await t.press("a", { ctrl: true });
  for (let i = 0; i < 7; i++) await t.press("DELETE");
  await t.paste("#203040\n");
  await t.press("RETURN");
  expect(t.frame()).toContain("#203040");
});

test("the sample follows the hex while it is typed, before enter", async () => {
  const t = await mount();
  await chooseCustom(t);
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  const sampleBg = () => {
    const y = rowsOf(t).findIndex((l) => l.includes("1 Seção ativa"));
    return t.spans().lines[y]!.spans.find((span) => span.text.includes("1 Seção ativa"))!.bg;
  };
  const before = sampleBg();
  await t.press("RETURN");
  await t.press("a", { ctrl: true });
  for (let i = 0; i < 7; i++) await t.press("DELETE");
  await t.type("#aa3355");
  expect(sampleBg().equals(before)).toBe(false);
});

test("Personalizado: a text token under 4.5:1 on bg shows a warning; Começar de copies another theme", async () => {
  const t = await mount();
  await chooseCustom(t);
  await t.press("ARROW_DOWN"); // começar de
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

test("Sistema keeps the keyboard free: esc reaches the bar from the page, from the editor and from a hex being edited", async () => {
  const t = await mount();
  expectButtonsReachable();
  await expectNoKeyboardTrap(t);
  await t.press("ARROW_DOWN");
  await chooseCustom(t);
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  await t.press("RETURN"); // editing a hex
  await expectNoKeyboardTrap(t);
});

test("hovering a row moves the selection: one marker, and ArrowDown continues from it", async () => {
  const t = await mount();
  const y = rowsOf(t).findIndex((l, i) => i > 1 && l.includes("símbolos"));
  await t.hover(10, y);
  expect(cursorRows(t)).toHaveLength(1);
  expect(rowsOf(t)[y]).toContain("»");
  await t.press("ARROW_DOWN");
  expect(rowsOf(t).findIndex((l, i) => i > 1 && /^\s*▌?\s*»/.test(l))).toBe(rowsOf(t).findIndex((l, i) => i > 1 && l.includes("moldura")));
});

const spotOf = (t: TuiHarness, text: string, from = 1) => {
  const lines = t.frame().split("\n");
  const y = lines.findIndex((l, i) => i >= from && l.includes(text));
  return { x: lines[y]!.indexOf(text), y };
};

test("mouse: a click on a choice picks it and saves; a click on the checkbox toggles it", async () => {
  const t = await mount();
  await t.press("ARROW_UP"); // bar focused
  const claro = spotOf(t, "Claro");
  await t.click(claro.x + 1, claro.y);
  expect(t.frame()).not.toContain("troca aba"); // the click also moved the keyboard into the tab
  expect(rowOf(t, "tema")).toContain("[ Claro ]");
  const box = spotOf(t, "[ ] mostrar");
  await t.click(box.x + 1, box.y);
  expect(rowOf(t, "aba Tarefas")).toContain("[x] mostrar");
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath())).toMatchObject({ theme: "light", showTasksTab: true });
});

const panelBg = RGBA.fromHex(tokens.panel);
/** Background and text attributes of the cell at (x, y). */
function cellAt(t: TuiHarness, x: number, y: number) {
  let at = 0;
  for (const s of t.spans().lines[y]!.spans) {
    if (x < at + s.width) return s;
    at += s.width;
  }
  throw new Error("cell out of the frame");
}

test("bar focused: the selection stays muted with a › (never the » or the accent)", async () => {
  const t = await mount();
  await goTo(t, "tema");
  await t.press("ARROW_UP");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("troca aba");
  expect(rowOf(t, "atualização")).toContain("› atualização");
  expect(cursorRows(t)).toEqual([]);
  const update = spotOf(t, "atualização");
  expect(cellAt(t, update.x - 2, update.y).fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
});

test("bar focused: hovering a row tints it (panel background, dim ›) and keeps the selection; leaving clears it", async () => {
  const t = await mount();
  await t.press("ARROW_UP");
  const sym = spotOf(t, "símbolos");
  await t.hover(sym.x + 2, sym.y);
  expect(rowOf(t, "símbolos")).toContain("› símbolos");
  expect(cellAt(t, sym.x + 2, sym.y).bg.equals(panelBg)).toBe(true);
  expect(cursorRows(t)).toEqual([]);
  const tema = spotOf(t, "tema ");
  await t.hover(tema.x + 2, tema.y);
  expect(rowOf(t, "símbolos")).not.toContain("› símbolos"); // the tint moved with the mouse
  expect(cellAt(t, sym.x + 2, sym.y).bg.equals(panelBg)).toBe(false);
});

test("list active: hovering moves the selection (accent »), no tint left on the row", async () => {
  const t = await mount();
  const sym = spotOf(t, "símbolos");
  await t.hover(sym.x + 2, sym.y);
  expect(rowOf(t, "símbolos")).toContain("» símbolos");
  expect(cellAt(t, sym.x + 2, sym.y).bg.equals(panelBg)).toBe(false);
});

test("the editor: hovering a color value underlines it; a click on it edits it", async () => {
  const t = await mount();
  await chooseCustom(t);
  await t.press("ARROW_UP"); // from `tema` up to the first row, then the bar
  await t.press("ARROW_UP");
  const bg = spotOf(t, "#0e1013");
  await t.hover(bg.x, bg.y);
  expect(cellAt(t, bg.x, bg.y).attributes & TextAttributes.UNDERLINE).toBeGreaterThan(0);
  await t.click(bg.x, bg.y);
  expect(t.frame()).toContain("aplica"); // editing
});

/** A stub of the GitHub API: the latest release is `v9.9.9` and has no assets, so an update stops before any download. */
function stubReleases() {
  const slow = async () => {
    await new Promise((r) => setTimeout(r, 150)); // long enough for a frame with the spinner
    return Response.json({ tag_name: "v9.9.9", assets: [] });
  };
  return Bun.serve({ port: 0, fetch: slow });
}

const FAKE_BINARY = () => join(pvxHome(), "pvx-fake-binary");

test("pvx section: the version, the platform, the data dir and the uninstall command as a dim hint", async () => {
  const t = await mount();
  const f = t.frame();
  for (const s of ["versão        0.1.0", `${process.platform}/${process.arch} · rodando pelo bun`, "dados", "carregados", "desinstalar   sudo pvx uninstall"]) expect(f, s).toContain(s);
  expect(f).not.toContain("[ desinstalar ]"); // a hint only: no button
  expect(f).not.toContain("embutidos"); // only a dev build has them
  const hint = spotOf(t, "sudo pvx uninstall");
  expect(cellAt(t, hint.x, hint.y).fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
});

test("pvx section: verificar shows a spinner, then the available version; running from source disables atualizar", async () => {
  const api = stubReleases();
  try {
    const t = await mount(120, 40, { PVX_API_BASE: `http://127.0.0.1:${api.port}` });
    process.env.PVX_API_BASE = `http://127.0.0.1:${api.port}`;
    expect(rowOf(t, "atualização")).toContain("sem binário");
    await t.press("RETURN"); // the cursor is on `verificar`
    expect(t.frame()).toContain("consultando");
    await new Promise((r) => setTimeout(r, 400));
    expect(rowOf(t, "atualização")).toContain("sem binário"); // 9.9.9 is out, but a run from source cannot update
  } finally {
    api.stop(true);
  }
});

test("pvx section: a refused release check says why", async () => {
  const t = await mount();
  await t.press("RETURN");
  await new Promise((r) => setTimeout(r, 50));
  expect(t.frame()).toContain("consulta da última release falhou");
});

test("pvx section: atualizar runs self-update through the session (a block in the scrollback)", async () => {
  const api = stubReleases();
  const base = `http://127.0.0.1:${api.port}`;
  await Bun.write(FAKE_BINARY(), "binary");
  process.env.PVX_SELF_PATH = FAKE_BINARY();
  process.env.PVX_API_BASE = base;
  try {
    const t = await mount(120, 40, { PVX_API_BASE: base, PVX_SELF_PATH: FAKE_BINARY() });
    await t.press("RETURN"); // verificar
    await new Promise((r) => setTimeout(r, 400));
    await t.press("ARROW_LEFT"); // atualizar
    await t.press("RETURN");
    await new Promise((r) => setTimeout(r, 100));
    const block = lastStore!.blocks.find((b) => b.line === "self-update");
    expect(block).toBeDefined();
    expect(block!.lines.map((l) => l.text).join("\n")).toContain("não tem");
  } finally {
    delete process.env.PVX_SELF_PATH;
    process.env.PVX_API_BASE = "http://127.0.0.1:9";
    api.stop(true);
  }
});

test("pvx section: `u` updates from anywhere on the page, and a click on [ verificar ] checks", async () => {
  const t = await mount();
  await t.press("3");
  await t.press("u");
  expect(t.frame()).toContain("sem binário"); // blocked: the notice says why
  const verify = spotOf(t, "[ verificar ]");
  await t.click(verify.x + 2, verify.y);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.frame()).toContain("consulta da última release falhou");
});
