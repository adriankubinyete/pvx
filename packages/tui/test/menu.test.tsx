import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, buildRoot, createMenuNav, createSessionStore, itemsAt, Menu, ModuleChips, theme } from "../src/index.ts";

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
  const root = { id: "menu", scope: "menu" as const, element: <Menu store={store} registry={registry} nav={createMenuNav()} version="0.1.0" /> };
  h = await renderTui(
    <App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} chips={<ModuleChips registry={registry} />} />,
    { cols: opts.cols, rows: opts.rows },
  );
  return { t: h, store };
}
/** Arrows until `label` has the cursor. */
async function goto(t: TuiHarness, label: string, key: "ARROW_DOWN" | "ARROW_UP" = "ARROW_DOWN") {
  for (let i = 0; i < 40 && !new RegExp(`» ${label}\\b`).test(t.frame()); i++) await t.press(key);
  expect(t.frame()).toMatch(new RegExp(`» ${label}\\b`));
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
  expect(root.slice(-4).map((i) => i.line)).toEqual(["conformidade", "plano", "modules", "logs"]);
  const labels = root.map((i) => i.label);
  expect(labels.slice(0, -4)).toEqual([...labels.slice(0, -4)].sort());
  expect(root.find((i) => i.errorOf)).toBeDefined();
});

test("menu lists modules and core actions; enter into a module and a submenu, run a command, esc goes up", async () => {
  const { t } = await mount();
  for (const s of ["demo", "net", "3 comandos", "Conformidade", "Plano", "Módulos", "Logs", "✗ throws-on-load"]) expect(t.frame()).toContain(s);
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
  expect(t.frame()).toContain("Conformidade");
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

test("a core action runs the core command and shows its output", async () => {
  const { t, store } = await mount();
  await goto(t, "Módulos");
  await t.press("RETURN");
  await t.flush();
  expect(t.frame()).toContain("[✓] demo 1.0.0 carregado");
  expect(store.history.at(-1)).toBe("modules");
});

test("/ opens the session, esc with an empty input returns to the menu; ctrl+k opens the palette from the menu", async () => {
  const { t } = await mount();
  await t.press("/");
  expect(t.frame()).toContain("tab completa");
  await t.type("x");
  await t.press("ESCAPE"); // clears the input
  expect(t.frame()).toContain("tab completa");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("Conformidade");
  await t.press("k", { ctrl: true });
  expect(t.frame()).toContain("fila vazia");
  await t.press("ESCAPE");
  expect(t.frame()).not.toContain("fila vazia");
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
