import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, loadTuiState, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, buildRoot, createSessionStore, createTabsNav, footerFor, helpFor, itemsAt, KeyRouter, Tabs, theme, ThemeProvider, type Scope } from "../src/index.ts";
import { HelpOverlay } from "../src/Shortcuts.tsx";
import { detail, footerLine, gotoCard, selectedCorners, selectedName, subtleCorners } from "./cards-helpers.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
let registry: Registry;
let ran: string[];
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
  ran = [];
  const cmd = (help: string, extra: object = {}) => ({ help, run: (ctx: { out: { success(t: string): void }; args: Record<string, unknown> }) => (ran.push(help), ctx.out.success(`${help} ${ctx.args.addr ?? ""}`.trim())), ...extra });
  registry.register({ id: "net", version: "1.0.0", entry: "x" }, {
    commands: {
      "ip list": cmd("lista"),
      "ip accept": cmd("aceito", { args: [{ name: "addr", help: "Endereço", kind: "positional", required: true }] }),
      "port deny": cmd("negado", { destructive: true }),
    },
  });
});

async function mount(opts: { isRoot?: boolean; cols?: number; rows?: number; modules?: boolean } = {}) {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const isRoot = opts.isRoot ?? true;
  const store = createSessionStore({
    registry, makeLogger, isRoot, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  if (opts.modules) await h.press("TAB"), await h.press("ARROW_DOWN"); // Módulos, content focused
  return { t: h, store };
}
/** Opens the drill-down (commands and pages) of a module card, with its direct shortcut. */
async function drill(t: TuiHarness, id: string, dir: "ARROW_RIGHT" | "ARROW_LEFT" = "ARROW_RIGHT") {
  await gotoCard(t, id, dir);
  await t.press("l");
}
/** Arrows until a drill-down row `label` has the cursor. */
async function goto(t: TuiHarness, label: string, key: "ARROW_DOWN" | "ARROW_UP" = "ARROW_DOWN") {
  for (let i = 0; i < 40 && !new RegExp(`» ${label}(\\s|$)`).test(t.frame()); i++) await t.press(key);
  expect(t.frame()).toMatch(new RegExp(`» ${label}(\\s|$)`));
}

test("tree: submenus by path prefix, destructive mark, failed modules open their log", () => {
  const root = buildRoot(registry);
  const net = root.find((i) => i.id === "m:net")!;
  expect(net.help).toBe("1.0.0 carregado · 3 comandos");
  expect(net.children!.map((i) => i.label)).toEqual(["ip", "port"]);
  const ip = net.children![0]!;
  expect(ip.children!.map((i) => i.line)).toEqual(["net ip accept", "net ip list"]);
  expect(itemsAt(root, ["m:net", ip.id]).map((i) => i.label)).toEqual(["accept", "list"]);
  expect(net.children![1]!.children![0]).toMatchObject({ label: "deny", destructive: true });
  const labels = root.map((i) => i.label);
  expect(labels).toEqual([...labels].sort()); // modules only: the core actions are tabs now
  expect(root.find((i) => i.errorOf)).toBeDefined();
});

test("menu lists the modules; enter into a module and a submenu, run a command, esc goes up", async () => {
  const { t } = await mount({ modules: true });
  for (const s of ["demo", "net", "3 comandos", "throws-on-load"]) expect(t.frame()).toContain(s);
  await gotoCard(t, "net");
  await t.press("RETURN");
  expect(t.frame()).toContain("comandos e páginas"); // the action menu
  await t.press("RETURN");
  expect(t.frame()).toMatch(/ip\s+2 comandos/);
  await t.press("RETURN"); // ip
  await goto(t, "list");
  await t.press("RETURN");
  expect(t.frame()).toContain("[✓] lista");
  expect(ran).toEqual(["lista"]);
  await t.press("ESCAPE"); // result -> list
  expect(t.frame()).toContain("accept");
  await t.press("ESCAPE"); // ip -> net
  expect(t.frame()).toMatch(/port\s+1 comando/);
  expect(t.frame()).toContain("módulos › net");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("demo");
});

test("a command with args opens the form and shows the result; a secret field stays masked", async () => {
  const { t } = await mount({ modules: true });
  await drill(t, "net");
  await t.press("RETURN");
  await t.press("RETURN"); // accept (first in ip)
  expect(t.frame()).toContain("Addr *");
  await t.press("RETURN");
  expect(t.frame()).toContain("✗ preencha este campo");
  await t.type("1.2.3.4");
  await t.press("RETURN");
  expect(t.frame()).toContain("[✓] aceito 1.2.3.4");
  await t.press("RETURN");
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  await drill(t, "demo", "ARROW_LEFT");
  await goto(t, "login");
  await t.press("RETURN");
  await t.type("hunter2zz");
  expect(t.frame()).not.toContain("hunter2zz");
  expect(t.frame()).toContain("•••••••••");
  await t.press("RETURN");
  expect(t.frame()).toContain("token com 9 chars");
  expect(t.frame()).not.toContain("hunter2zz");
});

test("a core tab runs once on the first visit, then only on r; it leaves no block and no history", async () => {
  const { t, store } = await mount();
  await t.press("TAB"); // Módulos
    await t.press("TAB"); // Logs
  await t.flush();
  expect(t.frame()).toMatch(/atualizado|verificando/); // the Logs tab, named by the bar: no frame title
  expect(t.frame()).toMatch(/atualizado \d\d:\d\d:\d\d/);
  expect(store.history).toEqual([]);
  expect(store.blocks).toEqual([]);
  const first = t.frame().match(/atualizado \d\d:\d\d:\d\d/)![0];
  await t.press("TAB", { shift: true });
  await t.press("TAB"); // back: cached, not run again
  expect(t.frame()).toContain(first);
  await t.press("r");
  await t.flush();
  expect(t.frame()).toMatch(/atualizado/);
  expect(store.blocks).toEqual([]);
  expect(store.history).toEqual([]);
});

test("switching tabs keeps focus on the bar (down goes in); the Comando draft survives a tab switch", async () => {
  const { t } = await mount();
  await t.press("ARROW_UP");
  for (let i = 0; i < 3; i++) await t.press("ARROW_RIGHT"); // Comando, bar still focused
  expect(t.frame()).toContain("tab próxima aba");
  const inputRow = () => t.frame().split("\n").find((l) => l.includes("❯"))!;
  expect(inputRow()).not.toContain("▌");
  expect(t.frame()).toContain("digite um comando");
  await t.press("ARROW_DOWN");
  await t.type("demo gr");
  await t.press("TAB", { shift: true }); // Comando input has focus: tab would complete; shift+tab leaves
  expect(t.frame()).toContain("tab próxima aba");
  await t.press("TAB"); // back to Comando, still the bar
  expect(t.frame()).toContain("tab próxima aba");
  await t.press("ARROW_DOWN");
  expect(t.frame()).toContain("❯ demo gr");
});

test("/ goes to the Comando tab, esc with an empty input focuses the bar, tab still completes there; ctrl+k opens the palette", async () => {
  const { t } = await mount();
  await t.press("/");
  expect(t.frame()).toContain("tab completa");
  await t.type("demo gr");
  await t.press("TAB");
  expect(t.frame()).toContain("demo greet"); // tab completed, did not switch tab
  expect(t.frame()).toContain("tab completa");
  await t.press("ESCAPE"); // clears the input
  expect(t.frame()).toContain("tab completa");
  await t.press("ESCAPE"); // empty: focus goes to the bar
  expect(t.frame()).toContain("tab próxima aba"); // footer of the tabs scope
  await t.press("ARROW_LEFT");
  expect(t.frame()).toMatch(/atualizado|verificando/); // the Logs tab, named by the bar: no frame title
  await t.press("ARROW_RIGHT");
  await t.press("ARROW_DOWN"); // enters Comando: typing works again
  await t.type("x");
  expect(t.frame()).toContain("❯ x");
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  expect(t.frame()).not.toContain("fila vazia");
});

test("Comando: esc focuses the last block, up on the first block focuses the bar, down from the bar enters the input", async () => {
  const { t } = await mount();
  await t.press("/");
  await t.type("demo greet ana");
  await t.press("RETURN");
  await t.flush();
  await t.press("ESCAPE");
  expect(t.frame()).toContain("» demo greet ana");
  expect(t.frame()).toContain("r repetir");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("tab próxima aba"); // bar focused, block not
  expect(t.frame()).not.toContain("» demo greet ana");
  await t.press("ARROW_DOWN");
  await t.type("x");
  expect(t.frame()).toContain("❯ x");
});

test("tabs: tab and shift+tab cycle; the content of the new tab shows at once", async () => {
  const { t } = await mount();
  expect(t.frame()).toContain("▌ 1 Atenção");
  await t.press("TAB");
  expect(t.frame()).toContain("instalados");
    await t.press("TAB"); // Logs
  await t.press("TAB");
  expect(t.frame()).toContain("tab completa"); // Comando
  await t.press("TAB", { shift: true });
  expect(t.frame()).toMatch(/atualizado|verificando/); // the Logs tab, named by the bar: no frame title
  await t.press("TAB"); // Comando
  await t.press("TAB"); // Sistema
  expect(t.frame()).toContain("[1] aparência");
  await t.press("TAB"); // wraps to Início
  expect(t.frame()).toContain("1 Atenção"); // the Início section
});

test("tabs: up on the first row focuses the bar, right switches at once, down enters the first row", async () => {
  const { t } = await mount();
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("tab próxima aba");
  await t.press("ARROW_RIGHT");
  expect(t.frame()).toContain("instalados");
  expect(t.frame()).toContain("● carregado");
  expect(selectedName(t)).toBeUndefined(); // the bar has the focus
  await t.press("ARROW_DOWN"); // first card (bad-range: sorted)
  expect(selectedName(t)).toBe("bad-range");
  expect(t.frame()).toContain("↑↓←→ cartão");
  await t.press("ARROW_UP");
    await t.press("ARROW_RIGHT"); // Logs has nothing to select
  await t.press("ARROW_DOWN");
  expect(t.frame()).toContain("tab próxima aba");
});

test("tabs: each tab keeps its state; a failed module in Módulos opens its log", async () => {
  const { t } = await mount({ modules: true });
  await drill(t, "net");
  expect(t.frame()).toContain("módulos › net");
  await t.press("TAB");
  await t.press("TAB", { shift: true });
  expect(t.frame()).toContain("módulos › net");
  await t.press("ARROW_DOWN"); // the bar was focused after the switch
  await t.press("ESCAPE");
  await gotoCard(t, "throws-on-load");
  await t.press("RETURN");
  await t.press("RETURN"); // "ver o log" is the first action of a failed module
  expect(t.frame()).toContain("log throws-on-load");
  await t.press("ESCAPE");
  expect(selectedName(t)).toBe("throws-on-load");
});

test("Módulos: the bar hides the selection and the first row sits fully below the bar", async () => {
  const { t } = await mount({ cols: 80, rows: 24 });
  await t.press("TAB");
  await t.press("ARROW_DOWN");
  expect(selectedName(t)).toBeDefined();
  await t.press("ARROW_UP");
  expect(selectedName(t)).toBeUndefined(); // bar focused: no accent border
  const lines = t.frame().split("\n");
  expect(lines[0]).toContain("Módulos");
  expect(lines[1]).toMatch(/^ ─+ $/); // the rule under the bar
  expect(lines[2]).toContain("instalados"); // the switch right under the bar, not clipped
  expect(lines[3]).toContain("╭"); // and the first row of cards under it
  await t.press("ARROW_DOWN");
  expect(selectedName(t)).toBeDefined();
});

test("tabs: Módulos shows the load error count and the bar fits 80 columns", async () => {
  const { t } = await mount({ cols: 80, rows: 24 });
  const n = registry.errors.length;
  expect(n).toBeGreaterThan(1);
  const bar = t.frame().split("\n")[0]!;
  expect(bar).toContain(`Módulos ✗${n}`);
  for (const l of ["Início", "Logs", "Comando"]) expect(bar).toContain(l);
  expect(bar.length).toBeLessThanOrEqual(80);
  expect(bar).toContain("0.1.0"); // host and version fit on the right
});

test("non-root: a module command gives an error block and does not run", async () => {
  const { t, store } = await mount({ isRoot: false, modules: true });
  await drill(t, "net");
  await t.press("RETURN");
  await goto(t, "list");
  await t.press("RETURN");
  expect(t.frame()).toContain("rode com sudo");
  expect(ran).toEqual([]);
  expect(store.blocks[0]!.status).toBe("error");
});

/** Opens the form of `net ip accept` (addr*), 120x30. */
async function openForm() {
  const m = await mount({ cols: 120, rows: 30, modules: true });
  await drill(m.t, "net");
  await m.t.press("RETURN");
  await m.t.press("RETURN");
  return m.t;
}

test("form frame: the bar row is intact and the panel title sits whole on the next row", async () => {
  const t = await openForm();
  const [bar, , top] = t.frame().split("\n"); // the rule is row 1
  for (const l of ["Início", "Módulos", "Logs", "Comando", "0.1.0"]) expect(bar).toContain(l);
  expect(bar).not.toMatch(/[╭╮─]/); // no frame on the bar row (the `│` is the separator before the clock)
  expect(top).toContain("módulos › accept"); // one dim breadcrumb line, no box
  expect(t.frame()).not.toMatch(/[╭╮╰╯]/);
});

test("form footer comes from the form scope: no tab bar hint, and every key shown is handled", async () => {
  const t = await openForm();
  const foot = t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  for (const s of footerFor("form")) expect(foot).toContain(`${s.keys} ${s.label}`);
  expect(foot).not.toContain("tab abas");
  expect(t.frame()).not.toContain("tab campo ·"); // no inline hint line: the footer is the only place
  await t.type("x");
  expect(t.frame()).toMatch(/Addr \*\s+x/);
  await t.press("k", { ctrl: true }); // ctrl+k palette
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  await t.press("ESCAPE"); // esc volta
  expect(t.frame()).toContain("módulos › net");
});

test("form: tab moves to the next field, space marks a flag, enter runs; result footer: enter goes back", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await drill(t, "demo");
  await goto(t, "greet");
  await t.press("RETURN"); // who* (option) + shout (flag)
  expect(t.frame()).toMatch(/› Who/);
  await t.press("TAB");
  expect(t.frame()).toMatch(/› Shout/);
  expect(t.frame()).toContain("[ ]");
  await t.press(" ");
  expect(t.frame()).toContain("[x]");
  await t.press("s", { ctrl: true });
  expect(t.frame()).toContain("✗ preencha este campo"); // the focus went back to the required field
  await t.type("ana");
  await t.press("s", { ctrl: true }); // ctrl+s roda
  const foot = t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  for (const s of footerFor("result")) expect(foot).toContain(`${s.keys} ${s.label}`);
  await t.press("RETURN"); // enter voltar
  expect(t.frame()).toContain("» greet");
});

test("log screen footer comes from the log scope and its keys work", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await gotoCard(t, "throws-on-load");
  await t.press("RETURN");
  await t.press("RETURN");
  expect(t.frame()).toContain("› log throws-on-load");
  const foot = t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  for (const s of footerFor("log")) expect(foot).toContain(`${s.keys} ${s.label}`);
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  expect(selectedName(t)).toBe("throws-on-load");
});

test("footer follows focus: bar focused shows the tab-bar shortcuts in every tab; enter on the bar acts like down", async () => {
  const { t } = await mount({ cols: 120, rows: 30 });
  const foot = () => t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  const expectScope = (scope: "tabs" | "modules" | "home") => {
    for (const s of footerFor(scope)) expect(foot()).toContain(`${s.keys} ${s.label}`);
    expect(foot()).toContain(scope === "tabs" ? "↓/enter entra na aba" : scope === "home" ? "enter abre" : "↑↓←→ cartão");
    expect(foot()).not.toContain(scope === "tabs" ? "↑↓ move" : "troca aba");
  };
  expectScope("home");
  await t.press("ARROW_UP"); // top of the panel -> bar
  expectScope("tabs");
  await t.press("RETURN"); // enter == down: the first panel of Início
  expectScope("home");
  await t.press("ARROW_UP");
  await t.press("TAB"); // Módulos, bar still focused
  expect(t.frame()).toContain("instalados");
  expectScope("tabs");
  await t.press("RETURN");
  expectScope("modules"); // the Módulos cards
  expect(selectedName(t)).toBeDefined();
  await t.press("ARROW_UP");
    await t.press("TAB"); // Logs: nothing to select, enter does nothing
  await t.press("RETURN");
  expect(foot()).toContain("troca aba");
  expect(t.frame()).toMatch(/atualizado|verificando/);
});

test("every tab content and pushed screen uses the same title convention", async () => {
  const { t } = await mount({ cols: 120, rows: 30 });
  expect(t.frame().split("\n")[2]).toMatch(/^\s+\S+\s+.* · ligado há /); // row 0 is the bar, row 1 the rule, then the content: no frame, no repeated title
  await t.press("ARROW_UP");
  await t.press("TAB");
  expect(t.frame().split("\n")[2]).toMatch(/^\s+instalados \d+\s+catálogo\s+c alterna/); // the switch: Módulos has cards, not a panel
});

/** The help is fully visible at 80x24: title, first row, last row (the hint), and no row cut by the frame. */
const seeHelp = (t: TuiHarness, scope: Scope) => {
  const f = t.frame();
  const lines = f.split("\n");
  expect(f, scope).toContain("ajuda · esc fecha");
  expect(f, scope).toContain("o rodapé mostra só as teclas principais");
  for (const s of helpFor(scope)) expect(f, `${scope} ${s.keys}`).toContain(s.label);
  expect(lines.some((l) => l.includes("╰")), scope).toBe(true); // bottom border is on screen
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
};

test("? help fits 80x24 from every main context and esc returns to the same focus", async () => {
  const m = await mount({ cols: 80, rows: 24, modules: true });
  const t = m.t;
  for (let i = 0; i < 100 && !t.frame().split("\n")[7]?.includes("1.0.0"); i++) (await Bun.sleep(50), await t.flush()); // the card rows load async (listModules): compare frames only after the first row shows its version
  const check = async (scope: Scope, footerKey: string) => {
    const before = t.frame();
    await t.press("?");
    seeHelp(t, scope);
    await t.press("ESCAPE");
    await t.flush();
    expect(t.frame()).not.toContain("ajuda · esc fecha");
    expect(t.frame(), scope).toBe(before);
    expect(t.frame().split("\n").filter((l) => l.trim()).at(-1)).toContain(footerKey);
  };
  await check("modules", "? ajuda"); // Módulos cards
  await t.press("ARROW_UP"); // first row -> bar
  await check("tabs", "↓/enter entra na aba");
  await t.press("TAB", { shift: true });
  await check("tabs", "↓/enter entra na aba"); // bar on Início
  await t.press("ARROW_DOWN");
  await check("home", "r verifica");
  await t.type("/demo greet ana"); // `/` goes to Comando
  await t.press("RETURN");
  await t.flush();
  await t.press("ESCAPE"); // empty input -> last block
  await check("block", "r repetir");
});

/**
 * A focused text field (form field, Comando input, palette query) types `?` instead of opening help,
 * so those scopes are checked by rendering the overlay itself.
 */
test("help overlay of the text-input scopes fits 80x24", async () => {
  for (const scope of ["home", "menu", "form", "session", "palette", "block", "tabs", "modules", "catalog", "actions", "review", "files"] as const) {
    h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><HelpOverlay scope={scope} onClose={() => {}} /></KeyRouter></ThemeProvider>, { cols: 80, rows: 24 });
    seeHelp(h, scope);
    h.destroy();
  }
});

test("footer of the cards view has only the five rows; ? shows the legend and the direct shortcuts", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  expect(footerLine(t).trim()).toBe("↑↓←→ cartão   enter ações   c catálogo   a adicionar   ? ajuda");
  expect(footerFor("modules").map((s) => s.keys)).toEqual(["↑↓←→", "enter", "c", "a", "?"]);
  await t.press("?");
  const f = t.frame();
  for (const s of ["◆ ", "oficial (vem com o pvx)", "◇ ", "externo", "∞ ", "confia sempre", "⚠ ", "pede atenção", "comandos e páginas", "mostra ou oculta a aba", "widgets no Início"]) expect(f).toContain(s);
  expect(f.split("\n").filter((l) => l.includes("│") && /\? +ajuda/.test(l))).toHaveLength(1); // the global `?` row is replaced, not repeated
});

test("enter opens the action menu with only what applies; esc closes it", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await gotoCard(t, "net");
  await t.press("RETURN");
  let f = t.frame();
  for (const s of ["comandos e páginas", "atualizar", "desativar", "remover"]) expect(f).toContain(s);
  for (const s of ["revisar", "mostrar a aba", "widgets no Início", "abrir a aba"]) expect(f).not.toContain(s);
  expect(f).toMatch(/comandos e páginas\s+l/);
  expect(f).toMatch(/remover\s+x/);
  expect(footerLine(t)).toContain("esc fecha");
  await t.press("ARROW_DOWN");
  expect(f.split("\n").find((l) => l.includes("» comandos e páginas"))).toBeDefined();
  expect(t.frame().split("\n").find((l) => l.includes("» atualizar"))).toBeDefined();
  await t.press("ESCAPE");
  expect(t.frame()).not.toContain("comandos e páginas");
  expect(selectedName(t)).toBe("net"); // the same card stays selected
  await gotoCard(t, "ui-demo");
  await t.press("RETURN");
  f = t.frame();
  expect(f).toContain("abrir a aba Demo");
  expect(f).toMatch(/mostrar a aba\s+✓ t/);
  await t.press("ESCAPE");
  await gotoCard(t, "widget-demo");
  await t.press("RETURN");
  expect(t.frame()).toMatch(/widgets no Início\s+✓ w/);
});

test("direct shortcuts work on the selected card without the menu; the ones that do not apply say why", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await gotoCard(t, "net");
  await t.press("t");
  expect(t.frame()).toContain("este módulo não tem aba");
  await t.press("w");
  expect(t.frame()).toContain("não tem widgets no Início");
  await t.press("r");
  expect(t.frame()).toContain("nada a aprovar");
  await t.press("u"); // no host deps in this mount: read-only
  expect(t.frame()).toContain("somente leitura");
  expect(t.frame()).not.toContain("comandos e páginas"); // none of them opened the menu
  await t.press("l");
  expect(t.frame()).toContain("módulos › net");
});

test("ctrl+k opens the palette from the cards view, with the bar focused or not, and closes an open action menu first", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  await t.press("ARROW_UP"); // bar focused
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  await t.press("ARROW_DOWN");
  await t.press("RETURN"); // action menu of the first card (a failed module)
  expect(t.frame()).toContain("ver o log");
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  expect(t.frame()).not.toContain("ver o log");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("instalados");
});

test("mouse: hover moves the selection, click opens the menu; hover selects an item, click runs it, a click outside closes", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  const { x, y } = selectedCorners(t)[0]!;
  const w = 38; // card width at 120 columns
  await t.hover(x + w + 1 + 4, y + 1); // the second card
  expect(selectedName(t)).toBe("broken-entry");
  await t.click(x + w + 1 + 4, y + 1); // click opens its menu
  const rowOf = (s: string) => t.frame().split("\n").findIndex((l) => l.includes(s));
  expect(rowOf("ver o log")).toBeGreaterThan(0);
  const at = (s: string) => t.frame().split("\n")[rowOf(s)]!.indexOf(s) + 1;
  await t.hover(at("remover"), rowOf("remover"));
  expect(t.frame().split("\n").find((l) => l.includes("» remover"))).toBeDefined();
  expect(t.frame().split("\n").filter((l) => l.includes("»")).length).toBe(1);
  await t.click(2, 25); // outside the menu: closes it
  expect(t.frame()).not.toContain("ver o log");
  await t.click(x + w + 1 + 4, y + 1);
  await t.click(at("ver o log"), rowOf("ver o log")); // click runs: the module's log
  expect(t.frame()).toContain("log broken-entry");
});

test("mouse: the segments switch the view; the dashed cards are clickable", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  const row1 = () => t.frame().split("\n")[2]!; // row 1 is the rule under the bar
  await t.click(row1().indexOf("catálogo") + 2, 2);
  expect(footerLine(t)).toContain("c instalados");
  await t.click(row1().indexOf("instalados") + 2, 2);
  expect(footerLine(t)).toContain("c catálogo");
  for (let i = 0; i < 12; i++) await t.press("ARROW_RIGHT"); // the dashed cards, last row
  const lines = t.frame().split("\n");
  const y = lines.findIndex((l) => l.includes("abrir o catálogo"));
  await t.click(lines[y]!.indexOf("abrir o catálogo") + 2, y);
  expect(footerLine(t)).toContain("c instalados"); // the catalog view
  await t.click(row1().indexOf("instalados") + 2, 2);
  const ys = t.frame().split("\n").findIndex((l) => l.includes("adicionar por URL"));
  await t.click(t.frame().split("\n")[ys]!.indexOf("adicionar por URL") + 2, ys);
  expect(t.frame()).toContain("somente leitura"); // this mount has no host deps; with them the box opens
});

test("w toggles the module's Início widgets: notice, chip on the card, saved in the state", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await gotoCard(t, "widget-demo");
  await t.press("w");
  expect(t.frame()).toContain("✓ widgets do widget-demo ocultos no Início");
  expect(t.frame()).toContain("widget oculto");
  await Bun.sleep(400); // the state writer is debounced
  expect(loadTuiState(join(pvxHome(), "s.json")).hiddenWidgets).toEqual(["widget-demo"]);
  await t.press("w");
  expect(t.frame()).toContain("✓ widgets do widget-demo visíveis no Início");
  expect(t.frame()).not.toContain("widget oculto");
});

test("the selected card stays visible when the tab bar has the focus: muted border, detail strip kept", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  const name = selectedName(t)!;
  expect(selectedCorners(t)).toHaveLength(1);
  const at = selectedCorners(t)[0]!;
  await t.press("ARROW_UP"); // bar focused
  expect(selectedCorners(t)).toHaveLength(0); // no accent
  expect(subtleCorners(t)).toEqual([at]); // same card, muted border
  expect(detail(t)).toContain(name);
  await t.press("ARROW_DOWN");
  expect(selectedCorners(t)).toEqual([at]);
  expect(subtleCorners(t)).toHaveLength(0);
});

test("with the tab bar focused hovering a card does not move the selection; a click selects it and moves the focus into the grid", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  const w = 38;
  const first = selectedName(t)!;
  const at = selectedCorners(t)[0]!;
  await t.press("ARROW_UP"); // bar focused
  await t.hover(at.x + w + 1 + 4, at.y + 1); // the second card
  expect(subtleCorners(t)).toEqual([at]);
  expect(detail(t)).toContain(first);
  await t.click(at.x + w + 1 + 4, at.y + 1);
  expect(t.frame()).toContain("ver o log"); // its menu opened, as before
  await t.press("ESCAPE");
  expect(selectedName(t)).toBe("broken-entry"); // accent border: the focus moved into the grid
});
