import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { builtin } from "../../builtin/index.ts";
import { fold, parseEvents } from "../../builtin/notas/src/notes.ts";
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

const write = (e: object) => (mkdirSync(pvxHome(), { recursive: true }), appendFileSync(file(), `${JSON.stringify({ v: 1, at: new Date().toISOString(), ...e })}\n`));
const note = (id: string, author: string, text: string, extra: object = {}) => write({ id, ev: "add", author, text, ...extra });
const pin = (id: string, author = "carlos") => write({ id, ev: "pin", author });

let cur: ReturnType<typeof createSessionStore> | undefined;
async function mount(opts: { cols?: number; rows?: number; root?: boolean } = {}) {
  const store = createSessionStore({
    registry, makeLogger, isRoot: opts.root ?? true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: "", version: "0.1.0", theme }, argv),
  });
  cur = store;
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(
    <App root={root} logger={quiet()} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />,
    { cols: opts.cols ?? 100, rows: opts.rows ?? 30 },
  );
  await Bun.sleep(150); // the widgets' first collection
  await h.flush();
  return { t: h, store };
}
/** Notas is a page, not a tab: opened as a pushed screen (what the Módulos list does on enter). */
const goNotas = async (t: TuiHarness) => {
  await cur!.run("#nota.notas");
  await t.flush();
};

test("Início shows the notes panel only when the slot has data: pinned notes and the count of new ones", async () => {
  const { t } = await mount();
  expect(t.frame()).not.toContain("notas");
  t.destroy();
  note("a1a1a1", "carlos", "token trocado: feito relogin");
  pin("a1a1a1");
  note("b2b2b2", "carlos", "solta, nao fixada");
  const m = await mount();
  const f = m.t.frame();
  expect(f).toContain("› [3] notas");
  expect(f).toContain("2 novas");
  expect(f).toContain("carlos: token trocado: feito relogin");
  expect(f).not.toContain("solta, nao fixada");
});

test("80x24: the notes panel fits in one column and each fixed line stays alone on its line", async () => {
  note("a1a1a1", "carlos", "token trocado");
  pin("a1a1a1");
  const { t } = await mount({ cols: 80, rows: 24 });
  const lines = t.frame().split("\n");
  expect(lines[0]).toMatch(/^\s*Início\s+Módulos/);
  expect(lines.filter((l) => l.includes("› [3] notas"))).toHaveLength(1);
  expect(lines.some((l) => l.includes("carlos: token trocado"))).toBe(true);
  expect(lines.filter((l) => l.trim()).at(-1)).toContain("? ajuda"); // the footer line is intact
  await t.press("3");
  expect(t.frame()).toContain("› [3] notas ●");
});

test("a note with ANSI shows as inert text in the Notas page and in Início", async () => {
  note("c3c3c3", "carlos", "\u001b[31mvermelho\u001b[0m \u001b]0;x\u0007ok", { tags: ["t\u001b[2J"] });
  pin("c3c3c3");
  const { t } = await mount();
  expect(t.frame()).toContain("vermelho ok");
  await goNotas(t);
  expect(t.frame()).toContain("vermelho ok");
  expect(t.frame()).not.toMatch(/\u001b|\[31m|\[0m/);
});

test("Notas page: list with the unread dot, filters, and p / x on the note under the cursor", async () => {
  note("a1a1a1", "carlos", "primeira", { tags: ["sip"] });
  note("b2b2b2", "ana", "segunda da ana");
  const { t } = await mount();
  await goNotas(t);
  expect(t.frame()).toContain("● carlos");
  expect(t.frame()).not.toContain("● ana"); // the author's own note is never new
  expect(t.frame()).toMatch(/\[todas\]\s+fixadas 0\s+novas 1\s+minhas 1\s+#sip/);
  await t.press("f"); // fixadas
  expect(t.frame()).toContain("nenhuma nota aqui");
  await t.press("f"); // novas
  expect(t.frame()).toContain("primeira");
  expect(t.frame()).not.toContain("segunda da ana");
  await t.press("p"); // pin the one under the cursor
  await t.flush();
  expect(readFileSync(file(), "utf8")).toContain('"ev":"pin","author":"ana"');
  await t.press("x"); // resolve it
  await t.flush();
  expect(fold(parseEvents(readFileSync(file(), "utf8"))).find((n) => n.id === "a1a1a1")).toMatchObject({ pinned: true, resolved: true });
  expect(t.frame()).toContain("resolvida");
});

test("the composer saves through `nota add`: scrollback, history and the list show it; esc discards", async () => {
  const { t, store } = await mount();
  await goNotas(t);
  await t.press("n");
  expect(t.frame()).toContain("nova nota");
  expect(t.frame()).toContain("nunca cole senhas ou tokens");
  expect(t.frame()).toContain("ctrl+s salva");
  await t.type("primeira linha");
  await t.press("RETURN"); // Enter is a line break in the text area, not a submit
  await t.type("segunda");
  await t.press("TAB");
  await t.type("sip trunk");
  await t.press("TAB"); // nome exibido
  await t.press("TAB"); // fixar
  await t.press(" ");
  await t.press("s", { ctrl: true });
  await t.flush();
  const [add, pinned] = parseEvents(readFileSync(file(), "utf8"));
  expect(add).toMatchObject({ ev: "add", author: "ana", text: "primeira linha\nsegunda", tags: ["sip", "trunk"], login: false });
  expect(pinned).toMatchObject({ ev: "pin" });
  expect(t.frame()).toContain("primeira linha segunda"); // back in the list
  expect(t.frame()).toContain("#sip #trunk · fixada");
  expect(store.blocks.at(-1)!.line).toBe("nota add --tag sip --tag trunk --fixar");
  expect(store.history.at(-1)).toBe("nota add --tag sip --tag trunk --fixar");
  expect(readFileSync(join(pvxHome(), "tui-history"), "utf8")).not.toContain("primeira"); // the text is not in the history file

  await t.press("n");
  await t.type("descartada");
  await t.press("ESCAPE");
  expect(t.frame()).not.toContain("nova nota");
  expect(readFileSync(file(), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
});

test("a save without root shows `rode com sudo` and stays in the composer with the text", async () => {
  const { t } = await mount({ root: false });
  await goNotas(t);
  await t.press("n");
  await t.type("texto");
  await t.press("s", { ctrl: true });
  await t.flush();
  expect(t.frame()).toContain("rode com sudo");
  expect(t.frame()).toContain("texto");
  expect(t.frame()).toContain("nova nota");
});

test("`n` on Início opens the composer on the Notas page; the editable display name goes with --apelido", async () => {
  const { t } = await mount();
  await t.press("n");
  expect(t.frame()).toContain("nova nota");
  expect(t.frame()).toContain("autor ana");
  await t.type("oi");
  await t.press("TAB");
  await t.press("TAB"); // nome exibido
  await t.press("a", { ctrl: true });
  await t.type("A");
  await t.press("s", { ctrl: true });
  await t.flush();
  expect(JSON.parse(readFileSync(join(pvxHome(), "people.json"), "utf8"))).toEqual({ ana: "Aana" });
});

test("editing a note: `e` opens the composer with its text, ctrl+s writes an edit event", async () => {
  note("a1a1a1", "ana", "texto velho", { tags: ["sip"] });
  const { t } = await mount();
  await goNotas(t);
  await t.press("e");
  expect(t.frame()).toContain("editar nota a1a1a1");
  expect(t.frame()).toContain("texto velho");
  await t.type("!");
  await t.press("s", { ctrl: true });
  await t.flush();
  const n = fold(parseEvents(readFileSync(file(), "utf8")))[0]!;
  expect(n.text).toContain("!");
  expect(n.tags).toEqual(["sip"]);
});
