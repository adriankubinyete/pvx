import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCapture, runCli, type Registry } from "@pvx/core";
import { builtin } from "../../builtin/index.ts";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, ui } from "../src/index.ts";
import { conformityOf } from "../src/tabs/conformity.ts";
import { gotoCard } from "./cards-helpers.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} });
const makeLogger = (n: string) => createLogger(logsDir(), n);
let profilesDir = join(fixtures, "profiles");
let env: Record<string, string> = { PVX_PROFILE: "main" };

async function load(withBuiltin = true): Promise<Registry> {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  const registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: quiet, ui, builtin: withBuiltin ? builtin : [] });
  return registry;
}
beforeEach(() => ((profilesDir = join(fixtures, "profiles")), (env = { PVX_PROFILE: "main" })));

/** Every conformity command the host ran (the Logs tab passes by on the way), to prove that a refresh is one evaluation and nobody evaluates on its own. */
let cur: ReturnType<typeof createSessionStore> | undefined;
async function mount(registry: Registry, opts: { cols?: number; rows?: number } = {}) {
  const calls: string[] = [];
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => (argv[0] !== "logs" && calls.push(argv[0]!), runCapture({ env, isRoot: true, registry, makeLogger, profilesDir, version: "0.1.0", theme }, argv)),
  });
  cur = store;
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(
    <App root={root} logger={quiet()} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />,
    { cols: opts.cols ?? 120, rows: opts.rows ?? 40 },
  );
  return { t: h, store, calls };
}
/** Conformidade is a page, not a tab: pushed as a screen, as the Módulos list does on enter. */
const open = async (t: TuiHarness) => (await cur!.run("#conformidade.conformidade"), await t.flush());
const lastLine = (t: TuiHarness) => t.frame().split("\n").filter((l) => l.trim()).at(-1)!;

test("the built-in module is a page, not a tab; without it the page is gone and the CLI still works", async () => {
  const registry0 = await load();
  const { t } = await mount(registry0);
  expect(t.frame().split("\n")[0]).toMatch(/Início\s+Módulos.*\s+Demo\s+Logs\s+Comando/); // built-ins are not tabs; a module may opt in
  t.destroy();

  const bare = await load(false);
  await mount(bare);
  expect(bare.pages.has("conformidade.conformidade")).toBe(false);
  expect(registry0.pages.has("conformidade.conformidade")).toBe(true);
  const out: string[] = [];
  const exit = await runCli({
    argv: ["conformidade"], env: { PVX_PROFILE: "main" }, isTTY: false, isRoot: false, registry: bare, makeLogger, profilesDir, version: "0.1.0", theme,
    out: (l) => void out.push(l),
  });
  expect(exit).toBe(0);
  expect(out.join("\n")).toContain("cap-fixture.a: pendente");
});

test("Módulos marks the built-in module as official ◆", async () => {
  const { t } = await mount(await load());
  await t.press("TAB");
  await t.press("ARROW_DOWN");
  expect(t.frame()).toMatch(/◆ conformidade/);
  expect(t.frame()).toMatch(/oficial +[0-9]/); // origin on the left, the version on the right
  expect(t.frame()).not.toMatch(/◆ cap-fixture/);
});

test("Módulos: enter on a module lists its pages first (§); enter opens the page, esc returns to the same row", async () => {
  const { t } = await mount(await load());
  await t.press("TAB");
  await t.press("ARROW_DOWN");
  await gotoCard(t, "conformidade");
  await t.press("l"); // commands and pages
  expect(t.frame()).toMatch(/§ conformidade/);
  await t.press("RETURN");
  await t.flush();
  expect(t.frame()).toContain("› [1] resultados");
  await t.press("ESCAPE");
  await t.flush();
  expect(t.frame()).toMatch(/§ conformidade/); // back on the module's list, same item
});

test("Conformidade shows the cached results; r there and r in Início refresh the one cache", async () => {
  const { t, calls } = await mount(await load());
  await t.press("r"); // Início: runs the check
  await t.flush();
  expect(t.frame()).toMatch(/1 de 5/);
  expect(calls.sort()).toEqual(["conformidade", "plano"]); // one refresh = both
  await open(t);
  expect(t.frame()).toContain("[✓] fine: em ordem");
  expect(t.frame()).toContain("[✗] cap-fixture.a: pendente  → cap-fixture fix-a");
  expect(t.frame()).toContain("[!] manual: sem fix");
  expect(t.frame()).toContain("perfil Principal");
  expect(t.frame()).toContain("1 ok, 1 avisos, 3 erros");
  expect(t.frame()).toMatch(/verificado às \d\d:\d\d/);
  expect(calls).toHaveLength(2); // visiting did not evaluate again: Início had filled the cache
  expect(lastLine(t)).toContain("r atualiza");
  await t.press("r");
  await t.flush();
  expect(calls).toHaveLength(4);
  await t.press("ESCAPE"); // ... back to the tabs: Início reads the same cache
  expect(t.frame()).toMatch(/1 de 5/);
  expect(calls).toHaveLength(4);
});

test("the first visit to the page checks; Início sees the result without checking", async () => {
  const { t, calls } = await mount(await load());
  expect(t.frame()).toContain("não verificado");
  await open(t);
  await t.flush();
  expect(t.frame()).toContain("cap-fixture.a: pendente");
  await t.press("ESCAPE");
  expect(t.frame()).toMatch(/1 de 5/);
  expect(calls).toHaveLength(2);
});

test("the plan panel lists the steps in order and the manual items", async () => {
  const { t } = await mount(await load());
  await open(t);
  await t.flush();
  const f = t.frame();
  expect(f).toContain("1. cap-fixture fix-a para cap-fixture.a");
  expect(f).toContain("2. cap-fixture fix-b para cap-fixture.b");
  expect(f).toContain("3. cap-fixture fix-c para cap-fixture.c");
  expect(f).toContain("manual: manual: sem fix");
  expect(lastLine(t)).toContain("a aplica");
});

test("apply: y runs through the session, s skips, n stops; the keys exist only while asking", async () => {
  const { t, store } = await mount(await load());
  await open(t);
  await t.flush();
  expect(lastLine(t)).not.toContain("y aplica");
  await t.press("a");
  expect(t.frame()).toContain("aplicar `cap-fixture fix-a`?");
  expect(lastLine(t)).toMatch(/y aplica.*s pula.*n para/);
  await t.press("y");
  await t.waitForFrame((f) => f.includes("aplicar `cap-fixture fix-b`?"));
  expect(store.blocks.map((b) => [b.line, b.status])).toEqual([["cap-fixture fix-a", "ok"]]); // an ordinary command: scrollback and history
  expect(store.history).toContain("cap-fixture fix-a");
  await t.press("s");
  await t.waitForFrame((f) => f.includes("aplicar `cap-fixture fix-c`?"));
  await t.press("n");
  await t.waitForFrame((f) => f.includes("não executado"));
  expect(t.frame()).toContain("1 passo(s) aplicado(s), 1 pulado(s)");
  expect(store.blocks.map((b) => b.line)).toEqual(["cap-fixture fix-a"]); // skipped and stopped steps never ran
  expect(lastLine(t)).not.toContain("y aplica");
  expect(lastLine(t)).toContain("enter fecha");
  await t.press("RETURN");
  expect(t.frame()).toContain("1. cap-fixture fix-a"); // back to the live plan
});

test("apply stops at the first error", async () => {
  const { t } = await mount(await load());
  await open(t);
  await t.flush();
  await t.press("a");
  await t.press("y");
  await t.waitForFrame((f) => f.includes("fix-b`?"));
  await t.press("y"); // fix-b fails
  await t.waitForFrame((f) => f.includes("parou em"));
  expect(t.frame()).toContain("parou em `cap-fixture fix-b` (exit 1);");
  expect(t.frame()).not.toContain("fix-c`?");
});

test("regression: the step list does not change while applying, even if the cache is refreshed meanwhile", async () => {
  let fixed = false;
  const registry = await load();
  registry.register({ id: "flip", version: "1.0.0", entry: "x" }, {
    commands: { fix: { help: "Fixes x", run: (ctx) => ((fixed = true), ctx.out.success("x ok")) } },
    capabilities: [{ id: "flip.x", title: "x", goal: "g", fix: "flip fix", prove: () => (fixed ? { level: "ok", text: "ok" } : { level: "error", text: "pendente" }) }],
  });
  profilesDir = join(pvxHome(), "profiles");
  mkdirSync(profilesDir, { recursive: true });
  writeFileSync(join(profilesDir, "p.json"), JSON.stringify({ id: "main", title: "P", requires: ["flip.x", "cap-fixture.a", "cap-fixture.c"] }));
  const { t, store } = await mount(registry);
  await open(t);
  await t.flush();
  await t.press("a");
  await t.press("y"); // `flip fix` runs: the live plan loses a step on the next check
  await t.waitForFrame((f) => f.includes("fix-a`?"));
  expect(fixed).toBe(true);
  await t.press("r");
  await t.waitForFrame((f) => f.includes("verificado às"));
  await t.waitFor(() => !conformityOf(store).getSnapshot().running);
  expect(conformityOf(store).getSnapshot().plano!.lines.filter((l) => l.step).map((l) => l.step!.cmd)).toEqual(["cap-fixture fix-a", "cap-fixture fix-c"]); // the live plan shrank...
  const f = t.frame();
  expect(f).toContain("1. flip fix"); // ...the list on screen did not
  expect(f).toContain("2. cap-fixture fix-a");
  expect(f).toContain("3. cap-fixture fix-c");
  await t.press("y");
  await t.waitForFrame((f2) => f2.includes("fix-c`?"));
  await t.press("y");
  await t.waitForFrame((f2) => f2.includes("3 passo(s) aplicado(s)"));
});

test("with no applicable profile the tabs say so instead of failing", async () => {
  profilesDir = join(pvxHome(), "none");
  env = {};
  const registry = await load();
  const { t } = await mount(registry);
  await open(t);
  await t.flush();
  expect(t.frame()).toContain("nenhum perfil aplicável");
});

test("layout: side by side at 120x40, stacked at 80x24; each panel and the footer stay on screen", async () => {
  const wide = await mount(await load(), { cols: 120, rows: 40 });
  await open(wide.t);
  const row = wide.t.frame().split("\n").find((l) => l.includes("[1] resultados"))!;
  expect(row).toContain("[2] plano"); // same line: two columns
  expect(lastLine(wide.t)).toContain("r atualiza");
  wide.t.destroy();
  const small = await mount(await load(), { cols: 80, rows: 24 });
  await open(small.t);
  const lines = small.t.frame().split("\n");
  const i1 = lines.findIndex((l) => l.includes("[1] resultados"));
  const i2 = lines.findIndex((l) => l.includes("[2] plano"));
  expect(i1).toBeGreaterThan(-1);
  expect(i2).toBeGreaterThan(i1); // stacked
  expect(lines.slice(0, i2).join("\n")).toContain("1 ok, 1 avisos, 3 erros");
  expect(lines.slice(i2).join("\n")).toContain("1. cap-fixture fix-a");
  expect(lastLine(small.t)).toContain("r atualiza");
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
});

test("panels: the arrows follow the layout (→ side by side, ↓ stacked), 1 2 jump, enter nudges (nothing to enter)", async () => {
  const wide = await mount(await load());
  await open(wide.t);
  expect(wide.t.frame()).toContain("[1] resultados ●");
  await wide.t.press("ARROW_LEFT");
  expect(lastLine(wide.t)).toContain("nada aqui");
  await wide.t.press("ARROW_DOWN");
  expect(lastLine(wide.t)).toContain("nada aqui"); // nothing below when side by side
  await wide.t.press("ARROW_RIGHT");
  expect(wide.t.frame()).toContain("[2] plano ●");
  await wide.t.press("ARROW_RIGHT");
  expect(lastLine(wide.t)).toContain("nada aqui");
  await wide.t.press("ARROW_LEFT");
  expect(wide.t.frame()).toContain("[1] resultados ●");
  await wide.t.press("RETURN");
  expect(lastLine(wide.t)).toContain("nada para selecionar");
  await wide.t.press("2");
  expect(wide.t.frame()).toContain("[2] plano ●");
  await wide.t.press("1");
  expect(wide.t.frame()).toContain("[1] resultados ●");
  wide.t.destroy();

  const { t } = await mount(await load(), { cols: 80, rows: 24 });
  await open(t);
  await t.press("ARROW_RIGHT");
  expect(lastLine(t)).toContain("nada aqui"); // stacked: nothing on the right
  expect(t.frame()).toContain("[1] resultados ●");
  await t.press("ARROW_DOWN");
  expect(t.frame()).toContain("[2] plano ●");
  await t.press("ARROW_DOWN");
  expect(lastLine(t)).toContain("nada aqui");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("[1] resultados ●");
});
