import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, buildRoot, createSessionStore, createTabsNav, footerFor, itemsAt, Tabs, theme } from "../src/index.ts";

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
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />,
    { cols: opts.cols, rows: opts.rows },
  );
  if (opts.modules) await h.press("TAB"), await h.press("ARROW_DOWN"); // Módulos, content focused
  return { t: h, store };
}
/** Arrows until `label` has the cursor. */
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
  for (const s of ["demo", "net", "3 comandos", "✗ throws-on-load"]) expect(t.frame()).toContain(s);
  await goto(t, "net");
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
  await goto(t, "net");
  await t.press("RETURN");
  await t.press("RETURN");
  await t.press("RETURN"); // accept (first in ip)
  expect(t.frame()).toContain("addr*");
  await t.press("RETURN");
  expect(t.frame()).toContain("falta: addr");
  await t.type("1.2.3.4");
  await t.press("RETURN");
  expect(t.frame()).toContain("[✓] aceito 1.2.3.4");
  await t.press("RETURN");
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  await goto(t, "demo", "ARROW_UP");
  await t.press("RETURN");
  await goto(t, "login");
  await t.press("RETURN");
  await t.type("hunter2zz");
  expect(t.frame()).not.toContain("hunter2zz");
  expect(t.frame()).toContain("●●●●●●●●●");
  await t.press("RETURN");
  expect(t.frame()).toContain("token com 9 chars");
  expect(t.frame()).not.toContain("hunter2zz");
});

test("a core tab runs once on the first visit, then only on r; it leaves no block and no history", async () => {
  const { t, store } = await mount();
  await t.press("TAB"); // Módulos
  await t.press("TAB"); // Conformidade
  await t.flush();
  expect(t.frame()).toContain("› conformidade");
  expect(t.frame()).toMatch(/verificado às \d\d:\d\d/);
  expect(store.history).toEqual([]);
  expect(store.blocks).toEqual([]);
  const first = t.frame().match(/verificado às \d\d:\d\d/)![0];
  await t.press("TAB", { shift: true });
  await t.press("TAB"); // back: cached, not run again
  expect(t.frame()).toContain(first);
  await t.press("r");
  await t.flush();
  expect(t.frame()).toMatch(/verificado às/);
  expect(store.blocks).toEqual([]);
  expect(store.history).toEqual([]);
});

test("switching tabs keeps focus on the bar (down goes in); the Comando draft survives a tab switch", async () => {
  const { t } = await mount();
  await t.press("ARROW_UP");
  for (let i = 0; i < 5; i++) await t.press("ARROW_RIGHT"); // Comando, bar still focused
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
  expect(t.frame()).toContain("› logs");
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
  expect(t.frame()).toContain("› conformidade");
  await t.press("TAB");
  expect(t.frame()).toContain("› módulos");
  await t.press("TAB");
  await t.press("TAB");
  await t.press("TAB");
  await t.press("TAB");
  expect(t.frame()).toContain("tab completa"); // Comando
  await t.press("TAB", { shift: true });
  expect(t.frame()).toContain("› logs");
  await t.press("TAB"); // wraps from Comando
  await t.press("TAB", { shift: true });
  await t.press("TAB", { shift: true });
  await t.press("TAB", { shift: true });
  await t.press("TAB", { shift: true });
  await t.press("TAB", { shift: true });
  expect(t.frame()).toContain("› conformidade");
});

test("tabs: up on the first row focuses the bar, right switches at once, down enters the first row", async () => {
  const { t } = await mount();
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("tab próxima aba");
  await t.press("ARROW_RIGHT");
  expect(t.frame()).toContain("› módulos");
  expect(t.frame()).toContain("1.0.0 carregado");
  await t.press("ARROW_DOWN"); // first row (bad-range: sorted)
  expect(t.frame()).toMatch(/» /);
  expect(t.frame()).toContain("↑↓ move");
  await t.press("ARROW_UP");
  await t.press("ARROW_RIGHT"); // Conformidade has nothing to select
  await t.press("ARROW_DOWN");
  expect(t.frame()).toContain("tab próxima aba");
});

test("tabs: each tab keeps its state; a failed module in Módulos opens its log", async () => {
  const { t } = await mount({ modules: true });
  await goto(t, "net");
  await t.press("RETURN");
  expect(t.frame()).toContain("módulos › net");
  await t.press("TAB");
  await t.press("TAB", { shift: true });
  expect(t.frame()).toContain("módulos › net");
  await t.press("ARROW_DOWN"); // the bar was focused after the switch
  await t.press("ESCAPE");
  await goto(t, "✗ throws-on-load");
  await t.press("RETURN");
  expect(t.frame()).toContain("log throws-on-load");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("» ✗ throws-on-load");
});

test("Módulos: the bar hides the selection and the first row sits fully below the bar", async () => {
  const { t } = await mount({ cols: 80, rows: 24 });
  await t.press("TAB");
  await t.press("ARROW_DOWN");
  expect(t.frame()).toMatch(/» /);
  await t.press("ARROW_UP");
  expect(t.frame()).not.toMatch(/» /); // bar focused: no highlight
  const lines = t.frame().split("\n");
  expect(lines[0]).toContain("Módulos");
  expect(lines[1]).toContain("› módulos"); // the box title right under the bar, not clipped
  await t.press("ARROW_DOWN");
  expect(t.frame()).toMatch(/» /);
});

test("tabs: Módulos shows the load error count and the bar fits 80 columns", async () => {
  const { t } = await mount({ cols: 80, rows: 24 });
  const n = registry.errors.length;
  expect(n).toBeGreaterThan(1);
  const bar = t.frame().split("\n")[0]!;
  expect(bar).toContain(`Módulos ✗${n}`);
  for (const l of ["Início", "Conformidade", "Plano", "Logs", "Comando"]) expect(bar).toContain(l);
  expect(bar.length).toBeLessThanOrEqual(80);
  expect(bar).toContain("0.1.0"); // host and version fit on the right
});

test("non-root: a module command gives an error block and does not run", async () => {
  const { t, store } = await mount({ isRoot: false, modules: true });
  await goto(t, "net");
  await t.press("RETURN");
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
  await goto(m.t, "net");
  await m.t.press("RETURN");
  await m.t.press("RETURN");
  await m.t.press("RETURN");
  return m.t;
}

test("form frame: the bar row is intact and the panel title sits whole on the next row", async () => {
  const t = await openForm();
  const [bar, top] = t.frame().split("\n");
  for (const l of ["Início", "Módulos", "Conformidade", "Plano", "Logs", "Comando", "0.1.0"]) expect(bar).toContain(l);
  expect(bar).not.toMatch(/[╭╮─│]/);
  expect(top).toMatch(/^ ╭─› net ip accept─+╮/);
});

test("form footer comes from the form scope: no tab bar hint, and every key shown is handled", async () => {
  const t = await openForm();
  const foot = t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  for (const s of footerFor("form")) expect(foot).toContain(`${s.keys} ${s.label}`);
  expect(foot).not.toContain("tab abas");
  expect(t.frame()).not.toContain("tab campo ·"); // no inline hint line: the footer is the only place
  await t.type("x");
  expect(t.frame()).toContain("x_");
  await t.press("k", { ctrl: true }); // ctrl+k palette
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  await t.press("ESCAPE"); // esc volta
  expect(t.frame()).toContain("módulos › net");
});

test("form: tab moves to the next field, space marks a flag, enter runs; result footer: enter goes back", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await goto(t, "demo");
  await t.press("RETURN");
  await goto(t, "greet");
  await t.press("RETURN"); // who* (option) + shout (flag)
  expect(t.frame()).toMatch(/» who/);
  await t.press("TAB");
  expect(t.frame()).toMatch(/» shout/);
  expect(t.frame()).toContain("[ ]");
  await t.press(" ");
  expect(t.frame()).toContain("[x]");
  await t.press("RETURN");
  expect(t.frame()).toContain("falta: who");
  await t.press("TAB");
  await t.type("ana");
  await t.press("RETURN"); // enter roda
  const foot = t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  for (const s of footerFor("result")) expect(foot).toContain(`${s.keys} ${s.label}`);
  await t.press("RETURN"); // enter voltar
  expect(t.frame()).toContain("» greet");
});

test("log screen footer comes from the log scope and its keys work", async () => {
  const { t } = await mount({ cols: 120, rows: 30, modules: true });
  await goto(t, "✗ throws-on-load");
  await t.press("RETURN");
  expect(t.frame()).toContain("› log throws-on-load");
  const foot = t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  for (const s of footerFor("log")) expect(foot).toContain(`${s.keys} ${s.label}`);
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("» ✗ throws-on-load");
});

test("footer follows focus: bar focused shows the tab-bar shortcuts in every tab; enter on the bar acts like down", async () => {
  const { t } = await mount({ cols: 120, rows: 30 });
  const foot = () => t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
  const expectScope = (scope: "tabs" | "menu" | "home") => {
    for (const s of footerFor(scope)) expect(foot()).toContain(`${s.keys} ${s.label}`);
    expect(foot()).toContain(scope === "tabs" ? "↓/enter entra na aba" : "↑↓ move");
    expect(foot()).not.toContain(scope === "tabs" ? "↑↓ move" : "troca aba");
  };
  expectScope("home");
  await t.press("ARROW_UP"); // top of the panel -> bar
  expectScope("tabs");
  await t.press("RETURN"); // enter == down: the first panel of Início
  expectScope("home");
  await t.press("ARROW_UP");
  await t.press("TAB"); // Módulos, bar still focused
  expect(t.frame()).toContain("› módulos");
  expectScope("tabs");
  await t.press("RETURN");
  expectScope("menu");
  expect(t.frame()).toMatch(/» /);
  await t.press("ARROW_UP");
  await t.press("TAB"); // Conformidade: nothing to select, enter does nothing
  await t.press("RETURN");
  expect(foot()).toContain("troca aba");
  expect(t.frame().split("\n")[1]).toContain("› conformidade");
});

test("every tab content and pushed screen uses the same title convention", async () => {
  const { t } = await mount({ cols: 120, rows: 30 });
  expect(t.frame().split("\n")[2]).toMatch(/^ ╭─› conformidade ●─/); // row 1 is the home header
  await t.press("ARROW_UP");
  await t.press("TAB");
  expect(t.frame().split("\n")[1]).toMatch(/^ ╭─› módulos─/);
});
