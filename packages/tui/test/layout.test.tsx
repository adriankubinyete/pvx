// The layout rules of UI.md sections 14 to 18, pinned in frames at 80x24 and 120x40:
// the tab names the page, at most one border, the standard form, every control reachable by keyboard, the confirm dialog.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RGBA } from "@opentui/core";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { expectButtonsReachable, renderPage, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, tokens as base, ui } from "../src/index.ts";
import { applyAccent } from "../src/theme.ts";
import { headerParts } from "../src/sdk-ui/kit.tsx";
import { crumbOf } from "../src/sdk-ui/pages.tsx";
import { fieldsOfArgs, helpOf, humanize } from "../src/sdk-ui/labels.ts";

const MODULE = join(import.meta.dir, "../../core/test/fixtures/jobmodules/layout-demo");
const SIZES = [[80, 24], [120, 40]] as const;
const BORDER_CHARS = /[╭╮╰╯┌┐└┘]/;
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const rowsOf = (t: TuiHarness) => t.frame().split("\n");
const rowIndex = (t: TuiHarness, text: string) => rowsOf(t).findIndex((row) => row.includes(text));
const columnOf = (t: TuiHarness, text: string) => rowsOf(t)[rowIndex(t, text)]!.indexOf(text);
/** The tokens the app draws with: the dark theme with the default accent applied (it tints `selected`). */
const tokens = applyAccent("dark", base, "tema");
const color = (hex: string) => RGBA.fromHex(hex);
/** Columns from a label to its value cell: the widest label ("ID do cliente", 13) and the 2 columns after it. */
const CELL_OFFSET = 15;

/** The spans of the first row that has `text`, with `text`'s own span. */
function spanOf(t: TuiHarness, text: string, rowText = text) {
  const row = t.spans().lines[rowIndex(t, rowText)]!;
  const span = row.spans.find((s) => s.text.includes(text));
  if (!span) throw new Error(`"${text}" has no span`);
  return span;
}
/** The span that starts at column `x` of the row holding `text`. */
function spanAt(t: TuiHarness, text: string, x: number) {
  const row = t.spans().lines[rowIndex(t, text)]!;
  let at = 0;
  for (const span of row.spans) {
    if (x >= at && x < at + span.text.length) return span;
    at += span.text.length;
  }
  throw new Error(`no span at ${x}`);
}

// ---- 14 and 15: the tab names the page, sections are not boxes ----

let registry: Registry;
beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "pvx-layout-"));
  symlinkSync(MODULE, join(dir, "layout-demo"));
  process.env.PVX_USERMODULES = dir;
  registry = createRegistry();
  const noop = { debug() {}, info() {}, warn() {}, error() {} };
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => noop, ui });
});

async function mountTabs(cols: number, rows: number): Promise<TuiHarness> {
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  return renderTui(
    <App root={root} logger={makeLogger("t")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} pages={{ session: store, registry, makeLogger }} />,
    { cols, rows },
  );
}

for (const [cols, rows] of SIZES) {
  test(`a page shown as a tab has no frame and no title of its own, only the sections (${cols}x${rows})`, async () => {
    h = await mountTabs(cols, rows);
    for (let i = 0; i < 2; i++) await h.press("TAB"); // Início, Módulos, then the module tab
    const frame = h.frame();
    expect(frame).toContain("1 Rotinas");
    expect(frame).toContain("2 Autenticação");
    expect(frame).not.toContain("› Rotinas"); // the old frame title, repeating the tab
    expect(frame).not.toMatch(BORDER_CHARS);
    expect(rowIndex(h, "1 Rotinas")).toBeLessThanOrEqual(3); // right under the tab bar
  });

  test(`two sections: a header line each, the active one with the gutter, a blank row between, no box (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "sections", { cols, rows });
    const first = rowIndex(h, "1 Rotinas");
    const second = rowIndex(h, "2 Autenticação");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(rowsOf(h)[second - 1]!.trim()).toBe(""); // whitespace, not a border, above the header
    expect(h.frame()).not.toMatch(BORDER_CHARS);
    expect(rowsOf(h)[first]!).toContain("▌"); // the gutter runs down the active section, header included
    expect(rowsOf(h)[first + 1]!).toContain("▌");
    expect(rowsOf(h)[second]!).not.toContain("▌");
    expect(rowsOf(h)[second + 1]!).not.toContain("▌");
    const active = spanOf(h, "Rotinas", "1 Rotinas");
    const idle = spanOf(h, "Autenticação", "2 Autenticação");
    expect(active.fg.equals(color(tokens.accent))).toBe(true);
    expect(idle.fg.equals(color(tokens.dim))).toBe(true);
  });
}

test("a pushed page shows one dim breadcrumb line, no box; a tab page shows none", () => {
  expect(crumbOf("Autobackup", "nova rotina")).toEqual(["Autobackup", "nova rotina"]);
  expect(crumbOf("Rotinas", "Rotinas")).toEqual(["Rotinas"]);
});

test("a pushed page: the breadcrumb names the module's tab, and nothing is boxed", async () => {
  h = await renderPage(MODULE, "register", { cols: 80, rows: 24 });
  expect(rowsOf(h)[0]).toContain("Rotinas › Registrar");
  expect(h.frame()).not.toMatch(BORDER_CHARS);
});

test("headerParts: `[1] rotinas` is the number and a capitalized label; a trailing active glyph is dropped", () => {
  expect(headerParts("[1] rotinas", "●")).toEqual({ number: "1", label: "Rotinas" });
  expect(headerParts("[2] autenticação ●", "●")).toEqual({ number: "2", label: "Autenticação" });
  expect(headerParts("fases", "●")).toEqual({ number: undefined, label: "Fases" });
});

// ---- 16: the form speaks the technician's language ----

test("labels: a given label wins, else the name is humanized; the CLI plumbing leaves the help", () => {
  expect(humanize("id-cliente")).toBe("Id cliente");
  expect(helpOf("Senha do novo usuário (stdin, PVX_SECRET_PASSWORD ou prompt)")).toBe("Senha do novo usuário");
  expect(helpOf("Senha (segredo)")).toBe("Senha");
  const [user, password, root, client] = fieldsOfArgs([
    { name: "username", label: "Usuário", help: "Nome", kind: "positional", required: true },
    { name: "password", help: "Senha (stdin ou prompt)", kind: "positional", secret: true },
    { name: "root-path", help: "Pasta raiz", kind: "option" },
    { name: "id-cliente", label: "ID do cliente", help: "letras", kind: "option" },
  ]);
  expect([user!.label, password!.label, root!.label, client!.label]).toEqual(["Usuário", "Password", "Root path", "ID do cliente"]);
  expect(password).toMatchObject({ kind: "secret", help: "Senha" });
  const derived = fieldsOfArgs([{ name: "root-path", help: "Pasta", kind: "option" }], { "root-path": (values) => `clientes/${values.x}` });
  expect(derived[0]!.derive!({ x: "1" })).toBe("clientes/1");
  expect(user).toMatchObject({ required: true });
});

for (const [cols, rows] of SIZES) {
  test(`the standard form: title, required *, secret, optional fields, buttons, no command line (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "register", { cols, rows });
    const frame = h.frame();
    expect(rowsOf(h)[1]).toContain("Criar o usuário"); // the title, once
    expect(frame.match(/Criar o usuário/g)).toHaveLength(1);
    expect(rowsOf(h)[2]).toContain("Cria o usuário no UOE"); // the description (the command's help)
    for (const label of ["Usuário *", "Senha *", "Root path", "ID do cliente"]) expect(frame).toContain(label);
    expect(frame).toContain("Nome do novo usuário"); // the hint, right of the value
    expect(frame).toContain("[ criar e entrar ]");
    expect(frame).toContain("[ cancelar ]");
    for (const raw of ["root-path", "id-cliente", "username", "stdin", "PVX_SECRET", "prompt", "(segredo)", "$ pvx", "segredo fora da linha"]) expect(frame).not.toContain(raw);
    expect(frame).not.toMatch(BORDER_CHARS);
  });

  test(`the form: red *, a filled value cell of fixed width, a blank row between fields, aligned columns (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "register", { cols, rows });
    // 1. the required marker is the error token, never the accent
    const star = spanOf(h, " *");
    expect(star.fg.equals(color(tokens.error))).toBe(true);
    expect(star.fg.equals(color(tokens.accent))).toBe(false);
    // 2. every value cell has a fill, empty too, and the focused one a stronger one
    const userRow = rowIndex(h, "Usuário *");
    const cellX = columnOf(h, "Usuário *") + CELL_OFFSET + 5; // past the cursor cell, which has the accent fill
    const rootRow = rowIndex(h, "Root path");
    const focusedFill = spanAt(h, "Usuário *", cellX).bg;
    const idleFill = spanAt(h, "Root path", cellX).bg;
    expect(focusedFill.equals(color(tokens.selected))).toBe(true);
    expect(idleFill.equals(color(tokens.panel))).toBe(true);
    expect(idleFill.equals(color(tokens.bg))).toBe(false);
    // the cells have the same fixed width: the fill ends at the same column in every row
    const fillEnd = (text: string) => {
      const row = h!.spans().lines[rowIndex(h!, text)]!;
      let at = 0;
      let end = -1;
      for (const span of row.spans) {
        if (span.bg.equals(color(tokens.panel)) || span.bg.equals(color(tokens.selected))) end = at + span.text.length;
        at += span.text.length;
      }
      return end;
    };
    expect(fillEnd("Root path")).toBe(fillEnd("Senha *"));
    expect(fillEnd("Root path")).toBe(fillEnd("ID do cliente"));
    // 3. one blank row between two fields
    expect(rowIndex(h, "Senha *") - userRow).toBe(2);
    expect(rootRow - rowIndex(h, "Senha *")).toBe(2);
    expect(rowsOf(h)[userRow + 1]!.trim()).toBe("");
    // 4. the focus marker takes its own column: moving the focus moves no label and no cell
    const labelBefore = columnOf(h, "Root path");
    expect(rowsOf(h)[userRow]).toContain("›");
    await h.press("ARROW_DOWN");
    await h.press("ARROW_DOWN");
    expect(rowsOf(h)[rootRow]).toContain("›");
    expect(rowsOf(h)[userRow]).not.toContain("›");
    expect(columnOf(h, "Root path")).toBe(labelBefore);
    expect(columnOf(h, "Usuário *")).toBe(columnOf(h, "Senha *"));
    expect(spanAt(h, "Root path", cellX).bg.equals(color(tokens.selected))).toBe(true);
  });

  test(`the form: a secret shows •••• and ctrl+r shows it; the error sits under the value, red, with ✗; the primary button is filled (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "register", { cols, rows });
    await h.type("ana");
    await h.press("ARROW_DOWN");
    await h.type("segredo1");
    expect(h.frame()).toContain("••••••••");
    expect(h.frame()).not.toContain("segredo1");
    await h.press("r", { ctrl: true });
    expect(h.frame()).toContain("segredo1");
    await h.press("r", { ctrl: true });
    expect(h.frame()).not.toContain("segredo1");
    // empty required field: the error under the value
    await h.press("ARROW_UP");
    for (let i = 0; i < "ana".length; i++) await h.press("BACKSPACE");
    await h.press("s", { ctrl: true });
    const errorRow = rowIndex(h, "✗ preencha este campo");
    expect(errorRow).toBe(rowIndex(h, "Usuário *") + 1);
    expect(columnOf(h, "✗ preencha este campo")).toBe(columnOf(h, "Usuário *") + CELL_OFFSET);
    expect(spanOf(h, "✗ preencha este campo").fg.equals(color(tokens.error))).toBe(true);
    // the primary button has the accent fill; cancel is plain
    expect(spanOf(h, "[ criar e entrar ]").bg.equals(color(tokens.accent))).toBe(true);
    expect(spanOf(h, "[ cancelar ]").bg.equals(color(tokens.accent))).toBe(false);
  });
}

test("the form: a short terminal scrolls the fields, keeps the blank rows and the buttons", async () => {
  h = await renderPage(MODULE, "long", { cols: 80, rows: 24 });
  expect(h.frame()).toContain("[ salvar ]");
  expect(h.frame()).not.toContain("Campo 12"); // the area is shorter than the form
  for (let i = 0; i < 11; i++) await h.press("ARROW_DOWN"); // the last field
  expect(h.frame()).toContain("Campo 12");
  expect(h.frame()).toContain("[ salvar ]"); // the buttons stay
  expect(rowIndex(h, "Campo 12") - rowIndex(h, "Campo 11")).toBe(2); // the blank row is kept
});

test("the command form runs the command with the typed values; esc cancels", async () => {
  h = await renderPage(MODULE, "register", { cols: 80, rows: 24 });
  await h.type("ana");
  await h.press("ARROW_DOWN");
  await h.type("segredo1");
  await h.press("s", { ctrl: true });
  await h.flush();
  await h.waitForFrame((frame) => frame.includes("rodou"));
  await h.press("ESCAPE");
  expect(h.frame()).toContain("cancelou");
});

test("ctrl+d shows the command line, dim, on one line; the secret is not in it", async () => {
  h = await renderPage(MODULE, "register", { cols: 120, rows: 40 });
  await h.type("ana");
  await h.press("d", { ctrl: true });
  const line = rowsOf(h).find((row) => row.includes("$ pvx"))!;
  expect(line).toContain("layout-demo register ana");
  await h.press("ARROW_DOWN");
  await h.type("segredo1");
  await h.press("d", { ctrl: true });
  await h.press("d", { ctrl: true });
  expect(h.frame()).not.toContain("segredo1");
});

for (const [cols, rows] of SIZES) {
  test(`a derived field follows the others until it is edited; clearing it follows again; nothing on screen says so (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "folder", { cols, rows });
    expect(h.frame()).toContain("Pasta do cliente");
    expect(h.frame()).toContain("Onde os backups ficam no UOE");
    await h.type("12");
    await h.press("ARROW_DOWN");
    await h.type("acme");
    expect(h.frame()).toContain("clientes/12-acme");
    expect(h.frame()).not.toContain("preenchida sozinha");
    // edit the derived field: it keeps the typed text while the others change
    await h.press("ARROW_DOWN");
    await h.type("x");
    expect(h.frame()).toContain("clientes/12-acmex");
    await h.press("ARROW_UP");
    await h.press("ARROW_UP");
    await h.type("9");
    expect(h.frame()).toContain("clientes/12-acmex");
    expect(h.frame()).not.toContain("clientes/129-acme");
    // clear it: it follows again
    await h.press("ARROW_DOWN");
    await h.press("ARROW_DOWN");
    for (let i = 0; i < "clientes/12-acmex".length; i++) await h.press("BACKSPACE");
    expect(h.frame()).toContain("clientes/129-acme");
  });
}

// ---- 17: every control reachable by keyboard ----

for (const [cols, rows] of SIZES) {
  test(`the arrows reach the page action; enter runs it (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "sections", { cols, rows });
    expect(h.frame()).toContain("▶ rodar agora");
    expect(h.frame()).not.toContain("rodando agora");
    await h.press("ARROW_DOWN");
    await h.press("ARROW_DOWN");
    expect(spanOf(h, "▶ rodar agora").bg.equals(color(tokens.selected))).toBe(true); // the action row is the selected one
    await h.press("RETURN");
    expect(h.frame()).toContain("rodando agora");
    expectButtonsReachable();
  });
}

test("a Button with no key and no focus is flagged; with a key it is not", async () => {
  h = await renderPage(MODULE, "orphan", { cols: 80, rows: 24 });
  expect(() => expectButtonsReachable()).toThrow("[ rodar agora ]");
  h.destroy();
  h = await renderPage(MODULE, "keyed", { cols: 80, rows: 24 });
  expect(() => expectButtonsReachable()).not.toThrow();
  expect(h.frame()).toContain("r rodar agora"); // the key is in the footer
});

// ---- 18: the confirm dialog ----

for (const [cols, rows] of SIZES) {
  test(`confirm: a centered dialog with ruled blocks, centered text, no key hints, focus on the safe button (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "ask", { cols, rows });
    await h.press("x");
    const frame = h.frame();
    for (const text of ["Remover o IP 10.0.0.1?", "A regra deixa de valer agora.", "[ remover IP ]", "[ manter ]"]) expect(frame).toContain(text);
    // a rule between the title, the description and the buttons
    const titleRow = rowIndex(h, "Remover o IP 10.0.0.1?");
    expect(rowsOf(h)[titleRow + 1]).toMatch(/─{10}/);
    expect(rowsOf(h)[rowIndex(h, "A regra deixa de valer agora.") + 1]).toMatch(/─{10}/);
    // no key hints inside the box
    const boxRows = rowsOf(h).slice(titleRow - 1, rowIndex(h, "[ manter ]") + 2).join("\n");
    expect(boxRows).not.toMatch(/enter|esc|←→|tab/);
    // the dialog is in the middle of the screen
    const left = rowsOf(h)[titleRow]!.indexOf("│");
    const right = rowsOf(h)[titleRow]!.lastIndexOf("│");
    expect(Math.abs(left - (cols - 1 - right))).toBeLessThanOrEqual(2);
    expect(Math.abs(titleRow - (rows - 1 - rowIndex(h, "[ manter ]")))).toBeLessThanOrEqual(3);
    // each text is centered in the box
    for (const text of ["Remover o IP 10.0.0.1?", "A regra deixa de valer agora."]) {
      const row = rowsOf(h)[rowIndex(h, text)]!;
      const before = row.indexOf(text) - (left + 1);
      const after = right - (row.indexOf(text) + text.length);
      expect(Math.abs(before - after)).toBeLessThanOrEqual(1);
    }
    const buttons = rowsOf(h)[rowIndex(h, "[ manter ]")]!;
    const buttonsBefore = buttons.indexOf("[ remover IP ]") - (left + 1);
    const buttonsAfter = right - (buttons.indexOf("[ manter ]") + "[ manter ]".length);
    expect(Math.abs(buttonsBefore - buttonsAfter)).toBeLessThanOrEqual(1);
    // the page behind stays (dimmed): its text is still on screen
    expect(frame).toContain("sem resposta");
    // focus starts on the safe option; the destructive button is in the error style
    expect(spanOf(h, "[ manter ]").bg.equals(color(tokens.accent))).toBe(true);
    expect(spanOf(h, "[ remover IP ]").fg.equals(color(tokens.error))).toBe(true);
    expect(spanOf(h, "[ remover IP ]").bg.equals(color(tokens.error))).toBe(false);
  });
}

test("confirm keys: esc cancels, enter on the focused safe button keeps, → then enter confirms, tab moves", async () => {
  h = await renderPage(MODULE, "ask", { cols: 80, rows: 24 });
  await h.press("x");
  await h.press("ESCAPE");
  expect(h.frame()).toContain("manteve");
  expect(h.frame()).not.toContain("[ manter ]");
  await h.press("x");
  await h.press("RETURN"); // the safe button has the focus
  expect(h.frame()).toContain("manteve");
  await h.press("x");
  await h.press("ARROW_LEFT");
  expect(spanOf(h, "[ remover IP ]").bg.equals(color(tokens.error))).toBe(true); // focus moved: filled with the error style
  await h.press("TAB");
  expect(spanOf(h, "[ manter ]").bg.equals(color(tokens.accent))).toBe(true);
  await h.press("ARROW_LEFT");
  await h.press("RETURN");
  expect(h.frame()).toContain("confirmou");
});

test("confirm mouse: both buttons are clickable", async () => {
  h = await renderPage(MODULE, "ask", { cols: 80, rows: 24 });
  await h.press("x");
  await h.click(columnOf(h, "[ remover IP ]") + 2, rowIndex(h, "[ remover IP ]"));
  expect(h.frame()).toContain("confirmou");
  await h.press("x");
  await h.click(columnOf(h, "[ manter ]") + 2, rowIndex(h, "[ manter ]"));
  expect(h.frame()).toContain("manteve");
});

test("the delete button of a form asks in the dialog, with the labels the form gave; manter does not delete", async () => {
  h = await renderPage(MODULE, "folder", { cols: 80, rows: 24 });
  expect(h.frame()).toContain("[ remover ]");
  await h.click(columnOf(h, "[ remover ]") + 2, rowIndex(h, "[ remover ]"));
  for (const text of ["Remover o cliente?", "Os backups ficam no UOE.", "[ remover cliente ]", "[ manter ]"]) expect(h.frame()).toContain(text);
  await h.press("RETURN"); // manter
  expect(h.frame()).not.toContain("removeu");
  await h.click(columnOf(h, "[ remover ]") + 2, rowIndex(h, "[ remover ]"));
  await h.press("ARROW_LEFT");
  await h.press("RETURN");
  expect(h.frame()).toContain("removeu");
});
