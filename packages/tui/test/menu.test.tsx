import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, buildRoot, createSessionStore, createTabsNav, itemsAt, Tabs, theme } from "../src/index.ts";

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

async function mount(opts: { isRoot?: boolean; cols?: number; rows?: number } = {}) {
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
  expect(net.help).toBe("3 comandos");
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
  const { t } = await mount();
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
  expect(t.frame()).toContain("início › net");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("demo");
});

test("a command with args opens the form and shows the result; a secret field stays masked", async () => {
  const { t } = await mount();
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

test("a core tab runs the core command and shows its output", async () => {
  const { t, store } = await mount();
  await t.press("TAB"); // Módulos
  await t.press("TAB"); // Conformidade
  await t.flush();
  expect(store.history.at(-1)).toBe("conformidade");
  expect(t.frame()).toContain("› conformidade");
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

test("tabs: tab and shift+tab cycle; the content of the new tab shows at once", async () => {
  const { t } = await mount();
  expect(t.frame()).toContain("início");
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
  expect(t.frame()).toContain("início");
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
  const { t } = await mount();
  await goto(t, "net");
  await t.press("RETURN");
  expect(t.frame()).toContain("início › net");
  await t.press("TAB");
  await t.press("TAB", { shift: true });
  expect(t.frame()).toContain("início › net");
  await t.press("TAB");
  await goto(t, "✗ throws-on-load");
  await t.press("RETURN");
  expect(t.frame()).toContain("log throws-on-load");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("» ✗ throws-on-load");
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
  const { t, store } = await mount({ isRoot: false });
  await goto(t, "net");
  await t.press("RETURN");
  await t.press("RETURN");
  await goto(t, "list");
  await t.press("RETURN");
  expect(t.frame()).toContain("rode com sudo");
  expect(ran).toEqual([]);
  expect(store.blocks[0]!.status).toBe("error");
});

test("layout: single column at 80x24, side panel with the last commands at 120x40", async () => {
  const { t, store } = await mount({ cols: 80, rows: 24 });
  for (const l of t.frame().split("\n")) expect(l.length).toBeLessThanOrEqual(80);
  expect(t.frame()).not.toContain("últimos comandos");
  expect(t.frame()).toContain("ctrl+k palette"); // the footer comes from the menu scope
  t.destroy();
  const wide = await mount({ cols: 120, rows: 40 });
  await store.run("demo remember");
  await wide.t.flush();
  expect(wide.t.frame()).toContain("últimos comandos");
  expect(wide.t.frame()).toContain("pvx 0.1.0");
  expect(wide.t.frame()).toContain("módulos");
  wide.t.destroy();
});
