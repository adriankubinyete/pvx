import { afterEach, expect, test } from "bun:test";
import { RGBA, TextAttributes } from "@opentui/core";
import { join } from "node:path";
import { createLogger, createRegistry, loadTuiState, logsDir, pvxHome, runCapture, tuiStatePath } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
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

test("Sistema renders the section, the footer and the preview at 80x24 and 120x40", async () => {
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

const spotOf = (t: TuiHarness, text: string, from = 1) => {
  const lines = t.frame().split("\n");
  const y = lines.findIndex((l, i) => i >= from && l.includes(text));
  return { x: lines[y]!.indexOf(text), y };
};

test("mouse: the ‹ and › arrows step the value like ←/→, persist, and a click on the row selects it", async () => {
  const t = await mount();
  await t.press("ARROW_UP"); // bar focused
  const tema = spotOf(t, "tema ");
  const arrows = (y: number) => {
    const line = t.frame().split("\n")[y]!;
    const l = line.indexOf("‹");
    return { l, r: line.indexOf("›", l) }; // the row marker is also a ›
  };
  await t.click(arrows(tema.y).r, tema.y); // › = next
  expect(t.frame()).not.toContain("↓/enter entra na aba"); // the click also moved the keyboard into the tab
  expect(t.frame().split("\n")[tema.y]).toContain("Claro");
  await t.click(arrows(tema.y).l, tema.y); // ‹ = previous
  expect(t.frame().split("\n")[tema.y]).toContain("Escuro");
  await t.click(arrows(tema.y).r, tema.y);
  const sym = spotOf(t, "símbolos");
  await t.click(sym.x + 2, sym.y); // the row: selects it, so → changes it
  await t.press("ARROW_RIGHT");
  expect(t.frame().split("\n")[sym.y]).toContain("ascii");
  const border = spotOf(t, "moldura");
  await t.hover(border.x + 2, border.y); // hover moves the selection
  await t.press("ARROW_RIGHT");
  expect(t.frame().split("\n")[border.y]).toContain("simples");
  t.destroy();
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath()).theme).toBe("light");
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
  await t.press("ARROW_UP");
  const tema = spotOf(t, "tema ");
  const line = t.frame().split("\n")[tema.y]!;
  expect(line).toContain("› tema");
  expect(t.frame()).not.toContain("»");
  expect(cellAt(t, tema.x - 2, tema.y).fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
});

test("bar focused: hovering a row tints it (panel background, dim ›) and keeps the selection; leaving clears it", async () => {
  const t = await mount();
  await t.press("ARROW_UP");
  const sym = spotOf(t, "símbolos");
  await t.hover(sym.x + 2, sym.y);
  expect(t.frame().split("\n")[sym.y]).toContain("› símbolos");
  expect(cellAt(t, sym.x + 2, sym.y).bg.equals(panelBg)).toBe(true);
  expect(t.frame()).not.toContain("»");
  const tema = spotOf(t, "tema ");
  await t.hover(tema.x + 2, tema.y);
  expect(t.frame().split("\n")[sym.y]).not.toContain("› símbolos"); // the tint moved with the mouse
  expect(cellAt(t, sym.x + 2, sym.y).bg.equals(panelBg)).toBe(false);
  await t.press("ARROW_DOWN"); // enters the tab: the selection is still the first row
  const rows = t.frame().split("\n");
  expect(rows.findIndex((l) => l.includes("»"))).toBe(tema.y);
});

test("list active: hovering moves the selection (accent »), no tint left on the row", async () => {
  const t = await mount();
  const sym = spotOf(t, "símbolos");
  await t.hover(sym.x + 2, sym.y);
  expect(t.frame().split("\n")[sym.y]).toContain("» símbolos");
  expect(cellAt(t, sym.x + 2, sym.y).bg.equals(panelBg)).toBe(false);
});

test("the ‹ and › arrows light up (bold, underlined) under the mouse, even with the bar focused", async () => {
  const t = await mount();
  await t.press("ARROW_UP");
  const tema = spotOf(t, "tema ");
  const line = t.frame().split("\n")[tema.y]!;
  const [l, r] = [line.indexOf("‹"), line.indexOf("›", tema.x + 4)];
  expect(cellAt(t, r, tema.y).attributes & TextAttributes.UNDERLINE).toBe(0);
  await t.hover(r, tema.y);
  expect(cellAt(t, r, tema.y).attributes & TextAttributes.UNDERLINE).toBeGreaterThan(0);
  expect(cellAt(t, l, tema.y).attributes & TextAttributes.UNDERLINE).toBe(0);
  await t.hover(l, tema.y);
  expect(cellAt(t, l, tema.y).attributes & TextAttributes.UNDERLINE).toBeGreaterThan(0);
  expect(cellAt(t, r, tema.y).attributes & TextAttributes.UNDERLINE).toBe(0);
});

test("Personalizado: hovering a token row tints it with the bar focused; a click on the hex value edits it", async () => {
  const t = await mount();
  for (let i = 0; i < 4; i++) await t.press("ARROW_RIGHT"); // custom
  await t.press("ARROW_UP"); // bar
  const bg = spotOf(t, "#0e1013");
  await t.hover(bg.x, bg.y);
  expect(cellAt(t, 6, bg.y).bg.equals(panelBg)).toBe(true);
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

test("pvx section: about the pvx, with the source-run text and the uninstall command as a hint", async () => {
  const t = await mount();
  await t.press("2");
  const f = t.frame();
  for (const s of ["[2] pvx", "sobre o pvx", "versão", "0.1.0", `${process.platform}/${process.arch}`, "rodando pelo bun", pvxHome(), "módulos de usuário", "catálogo", "127.0.0.1:9/catalog.json", "0 carregados", "pvx uninstall"]) expect(f, s).toContain(s);
  expect(f).not.toContain("[ desinstalar ]"); // a hint only: no button
  await t.press("1");
  expect(t.frame()).toContain("cor de destaque");
});

test("pvx section: verificar shows a spinner, then installed against available; running from source disables atualizar", async () => {
  const api = stubReleases();
  try {
    const t = await mount(120, 40, { PVX_API_BASE: `http://127.0.0.1:${api.port}` });
    process.env.PVX_API_BASE = `http://127.0.0.1:${api.port}`;
    await t.press("2");
    expect(t.frame()).toContain("disponível");
    await t.press("RETURN"); // verificar
    expect(t.frame()).toContain("consultando");
    await new Promise((r) => setTimeout(r, 400));
    const f = t.frame();
    expect(f).toContain("instalada");
    expect(f).toContain("9.9.9");
    expect(f).toContain("[ atualizar ] rodando pelo bun");
  } finally {
    api.stop(true);
  }
});

test("pvx section: a refused release check says why", async () => {
  const t = await mount();
  await t.press("2");
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
    await t.press("2");
    await t.press("RETURN"); // verificar
    await new Promise((r) => setTimeout(r, 400));
    await t.press("ARROW_DOWN");
    await t.press("RETURN"); // atualizar
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

test("pvx section: a click on the section label and on [ verificar ] works", async () => {
  const t = await mount();
  const bar = t.frame().split("\n");
  const y = bar.findIndex((l) => l.includes("[2] pvx"));
  await t.click(bar[y]!.indexOf("[2] pvx") + 2, y);
  expect(t.frame()).toContain("sobre o pvx");
  const lines = t.frame().split("\n");
  const row = lines.findIndex((l) => l.includes("[ verificar ]"));
  await t.click(lines[row]!.indexOf("[ verificar ]") + 2, row);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.frame()).toContain("consulta da última release falhou");
});
