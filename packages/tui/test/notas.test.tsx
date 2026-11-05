import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeFrames } from "./frame-helpers.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { builtin } from "../../builtin/index.ts";
import { openNotes, parseEvents } from "../../builtin/notas/src/notes.ts";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, ui } from "../src/index.ts";

let h: TuiHarness | undefined;
let registry: Registry;
afterEach(() => h?.destroy());
const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} });
const makeLogger = (n: string) => createLogger(logsDir(), n);
const file = () => join(pvxHome(), "notes.jsonl");

beforeEach(async () => {
  process.env.SUDO_USER = "ana";
  process.env.PVX_USERMODULES = join(pvxHome(), "none");
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: quiet, ui, builtin });
});

const write = (e: object) => (mkdirSync(pvxHome(), { recursive: true }), appendFileSync(file(), `${JSON.stringify({ v: 2, at: new Date().toISOString(), ...e })}\n`));
const note = (id: string, text: string, extra: object = {}) => write({ id, ev: "add", author: "carlos", text, ...extra });
const notes = () => (existsSync(file()) ? openNotes(parseEvents(readFileSync(file(), "utf8"))) : []);

async function mount(opts: { cols?: number; rows?: number; root?: boolean } = {}) {
  const store = createSessionStore({
    registry, makeLogger, isRoot: opts.root ?? true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(
    <App root={root} logger={quiet()} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />,
    { cols: opts.cols ?? 100, rows: opts.rows ?? 30 },
  );
  await Bun.sleep(150); // the widgets' first collection
  await h.flush();
  return { t: h, store };
}
const openNotesSection = async (t: TuiHarness) => {
  await t.press("2");
  await t.press("RETURN");
};
const lines = (t: TuiHarness) => t.frame().split("\n");

test("Início has a Notas section that says `nenhuma` and offers `+ nova nota`", async () => {
  const { t } = await mount();
  expect(t.frame()).toContain("2 Notas");
  expect(t.frame()).toMatch(/│ nenhuma\s+\+ nova nota/);
  expect(registry.pages.has("nota.notas")).toBe(false); // no separate page any more
});

test("the notes show as `dd/mm  texto  — assinatura`, newest first, and the first one is on the collapsed line", async () => {
  note("a1a1a1", "token trocado", { at: "2026-10-14T10:00:00.000", signature: "Carlos" });
  note("b2b2b2", "solta, sem assinatura", { at: "2026-10-15T10:00:00.000" });
  const { t } = await mount();
  expect(t.frame()).toMatch(/│ 15\/10  solta, sem assinatura\s+\+ nova nota/);
  await openNotesSection(t);
  const rows = lines(t).filter((line) => /\d\d\/\d\d  /.test(line));
  expect(rows[0]).toMatch(/15\/10  solta, sem assinatura\s*│/);
  expect(rows[1]).toMatch(/14\/10  token trocado  — Carlos\s*│/);
  expect(t.frame()).toContain("+ nova nota");
});

test("80x24: the notes section fits in one column and the footer is intact", async () => {
  note("a1a1a1", "token trocado", { signature: "Carlos" });
  const { t } = await mount({ cols: 80, rows: 24 });
  const all = lines(t);
  expect(all.filter((l) => l.includes("2 Notas"))).toHaveLength(1);
  expect(all.filter((l) => l.trim()).at(-1)).toContain("? ajuda");
  await t.press("2");
  expect(activeFrames(t)).toEqual(["2"]);
  await t.press("RETURN");
  await Bun.sleep(30);
  await t.flush();
  expect(t.frame()).toContain("token trocado  — Carlos");
});

test("a note with ANSI shows as inert text in Início", async () => {
  note("c3c3c3", "\u001b[31mvermelho\u001b[0m \u001b]0;x\u0007ok", { signature: "m\u001b[1mal" });
  const { t } = await mount();
  await openNotesSection(t);
  expect(t.frame()).toContain("vermelho ok  — mal");
  expect(t.frame()).not.toMatch(/\u001b|\[31m|\[0m/);
});

test("`+ nova nota` opens the standard form: Nota is required, Assinatura is optional; ctrl+s saves through `nota add`", async () => {
  const { t, store } = await mount();
  await openNotesSection(t); // the row `+ nova nota`
  await t.press("RETURN");
  const f = t.frame();
  expect(f).toContain("Nova nota");
  expect(f).toMatch(/Nota \*/);
  expect(f).toMatch(/Assinatura(?! \*)/);
  expect(f).toContain("[ salvar nota ]");
  expect(f).toContain("[ cancelar ]");
  await t.press("s", { ctrl: true }); // empty
  expect(t.frame()).toContain("preencha este campo");
  expect(notes()).toHaveLength(0);
  await t.type("trocar a senha do trunk");
  await t.press("TAB");
  await t.type("Ana");
  await t.press("s", { ctrl: true });
  await t.flush();
  await Bun.sleep(50);
  await t.flush();
  expect(notes().map((n) => [n.n, n.text, n.signature])).toEqual([[1, "trocar a senha do trunk", "Ana"]]);
  expect(store.blocks.at(-1)!.line).toBe('nota add "trocar a senha do trunk" --assinatura Ana');
  expect(t.frame()).not.toContain("Nova nota"); // back in Início
  expect(t.frame()).toContain("nota criada");
  expect(t.frame()).toMatch(/\d\d\/\d\d  trocar a senha do trunk  — Ana/);
});

test("`n` opens the form from Início, and esc discards it", async () => {
  const { t } = await mount();
  await t.press("n");
  expect(t.frame()).toContain("Nova nota");
  await t.type("descartada");
  await t.press("ESCAPE");
  expect(t.frame()).not.toContain("Nova nota");
  expect(lines(t)[0]).toMatch(/Início/); // the tab bar is still there
  expect(existsSync(file())).toBe(false); // nothing was written
});

test("a save without root shows `rode com sudo` and stays in the form with the text", async () => {
  const { t } = await mount({ root: false });
  await t.press("n");
  await t.type("texto");
  await t.press("s", { ctrl: true });
  await t.flush();
  await Bun.sleep(50);
  await t.flush();
  expect(t.frame()).toContain("rode com sudo");
  expect(t.frame()).toContain("Nova nota");
  expect(t.frame()).toContain("texto");
});

test("enter on a note asks `remover nota` / `manter`; manter keeps it, remover takes it out", async () => {
  note("a1a1a1", "primeira", { signature: "Carlos" });
  note("b2b2b2", "segunda");
  const { t, store } = await mount();
  await openNotesSection(t);
  await t.press("ARROW_DOWN"); // second row: `primeira` (the newest, `segunda`, is first)
  await t.press("RETURN");
  const dialog = t.frame();
  expect(dialog).toContain("remover a nota?");
  expect(dialog).toContain("[ manter ]  [ remover nota ]");
  await t.press("RETURN"); // the safe option has the focus
  await t.flush();
  expect(notes()).toHaveLength(2);
  expect(t.frame()).not.toContain("nota removida");
  await t.press("RETURN");
  await t.press("ARROW_RIGHT");
  await t.press("RETURN");
  await t.flush();
  await Bun.sleep(50);
  await t.flush();
  expect(notes().map((n) => n.text)).toEqual(["segunda"]);
  expect(store.blocks.at(-1)!.line).toBe("nota remove 1");
  expect(t.frame()).toContain("nota removida");
  expect(t.frame()).not.toContain("primeira");
});
