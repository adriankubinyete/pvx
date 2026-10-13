import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addModule, createLogger, createRegistry, linkModule, loadModules, logsDir, pvxHome, runCapture, setEnabled, trustGate, type Catalog, type LoadOpts, type Pending, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";

const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} });
const makeLogger = (n: string) => createLogger(logsDir(), n);
let h: TuiHarness | undefined;
let tmp = "";
let marker = "";
let registry: Registry;
let load: LoadOpts;

const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pvx-tui-mod-"));
  process.env.PVX_USERMODULES = join(pvxHome(), "usermodules");
  marker = join(tmp, "marker");
  process.env.PVX_TEST_MARKER = marker;
});
afterEach(() => {
  h?.destroy();
  delete process.env.PVX_TEST_MARKER;
  rmSync(tmp, { recursive: true, force: true });
});

interface Origin {
  url: string;
  work: string;
  commit(files: Record<string, string>, message?: string): string;
}
/** A work repo pushing to a bare origin; the module writes PVX_TEST_MARKER at import time. */
function origin(id: string, extra: Record<string, unknown> = {}, factory = `({ commands: { hi: { help: "hi", run: (ctx: any) => ctx.out.success("oi de ${id}") } } })`): Origin {
  const work = join(tmp, `${id}-work`);
  const bare = join(tmp, `${id}.git`);
  mkdirSync(work, { recursive: true });
  sh(work, "init", "-q", "-b", "main");
  const o: Origin = {
    url: `file://${bare}`,
    work,
    commit(files, message = "c") {
      for (const [f, c] of Object.entries(files)) writeFileSync(join(work, f), c);
      sh(work, "add", "-A");
      sh(work, "commit", "-q", "-m", message);
      sh(work, "push", "-q", bare, "main");
      return sh(work, "rev-parse", "HEAD");
    },
  };
  writeFileSync(join(work, "index.ts"), `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.PVX_TEST_MARKER!, "imported");\nexport default () => ${factory};\n`);
  writeFileSync(join(work, "pvx-module.json"), JSON.stringify({ id, version: "1.0.0", entry: "index.ts", contributes: { commands: ["hi"] }, ...extra }));
  sh(work, "add", "-A");
  sh(work, "commit", "-q", "-m", "init");
  sh(tmp, "clone", "-q", "--bare", work, bare);
  sh(work, "remote", "add", "origin", bare);
  return o;
}
const dirOf = (id: string) => join(process.env.PVX_USERMODULES!, id);
/** Installed and approved, like after `modules add --trust`. */
async function install(o: Origin, id: string) {
  const r = await addModule(o.url, { hostVersion: "0.1.0", allowFile: true, trust: sh(o.work, "rev-parse", "HEAD") });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(existsSync(dirOf(id))).toBe(true);
}

interface MountOpts {
  isRoot?: boolean;
  cols?: number;
  rows?: number;
  catalog?: Catalog;
  pending?: Pending[];
}
async function mount(o: MountOpts = {}) {
  registry = createRegistry();
  load = { hostVersion: "0.1.0", makeLogger: quiet, canImport: trustGate() };
  await loadModules(registry, load);
  const isRoot = o.isRoot ?? true;
  const store = createSessionStore({
    registry, makeLogger, isRoot, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot, registry, makeLogger, profilesDir: join(pvxHome(), "none"), version: "0.1.0", theme }, argv),
  });
  const modules = {
    load, allowFile: true,
    catalog: async () => o.catalog ?? { modules: [], source: "embutido" as const },
    pending: async () => o.pending ?? [],
  };
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} modules={modules} /> };
  h = await renderTui(
    <App root={root} logger={quiet()} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />,
    { cols: o.cols ?? 120, rows: o.rows ?? 40 },
  );
  await h.press("TAB");
  await h.press("ARROW_DOWN"); // Módulos, list focused
  return { t: h, store };
}
/** Arrows until the row of `id` has the cursor. */
async function goto(t: TuiHarness, id: string) {
  for (let i = 0; i < 30 && !new RegExp(`» (✗ )?${id}(\\s|$)`).test(t.frame()); i++) await t.press("ARROW_DOWN");
  expect(t.frame()).toMatch(new RegExp(`» (✗ )?${id}(\\s|$)`));
}
/** Waits in real time (git and disk work is async) until the frame satisfies `pred`. */
async function see(t: TuiHarness, pred: (f: string) => boolean): Promise<string> {
  for (let i = 0; i < 100 && !pred(t.frame()); i++) {
    await Bun.sleep(50);
    await t.flush();
  }
  expect(pred(t.frame()), t.frame()).toBe(true);
  return t.frame();
}
const footer = (t: TuiHarness) => t.frame().split("\n").filter((l) => l.trim()).at(-1)!;

test("Módulos rows show every state: carregado, aguardando confiança, desativado, modificado, atrás ↓n, dev, erro", async () => {
  const ok = origin("okm");
  const wait = origin("waitm");
  const off = origin("offm");
  const mod = origin("modm");
  const behind = origin("behm");
  const bad = origin("badm", {}, `(() => { throw new Error("falha na fábrica") })()`);
  for (const [o, id] of [[ok, "okm"], [off, "offm"], [mod, "modm"], [behind, "behm"], [bad, "badm"]] as const) await install(o, id);
  expect((await addModule(wait.url, { hostVersion: "0.1.0", allowFile: true })).ok).toBe(true); // no trust
  expect(setEnabled("offm", false).ok).toBe(true);
  writeFileSync(join(dirOf("modm"), "extra.txt"), "x"); // dirty tree
  behind.commit({ "n.txt": "n" }, "novo");
  sh(dirOf("behm"), "fetch", "-q");
  const devDir = join(tmp, "devm");
  mkdirSync(devDir);
  writeFileSync(join(devDir, "pvx-module.json"), JSON.stringify({ id: "devm", version: "0.0.1", entry: "index.ts" }));
  writeFileSync(join(devDir, "index.ts"), "export default () => ({});\n");
  expect(linkModule(devDir).ok).toBe(true);

  const { t } = await mount();
  const f = await see(t, (x) => /okm.*carregado/.test(x) && /behm.*↓1/.test(x));
  expect(f).toMatch(/okm ◇\s+main@\w{7} 1\.0\.0 carregado · 1 comando/);
  expect(f).toMatch(/waitm ◇\s+main@\w{7} 1\.0\.0 aguardando confiança/);
  expect(f).toMatch(/offm ◇\s+1\.0\.0 desativado/);
  expect(f).toMatch(/modm ◇\s+main@\w{7} ✎1 1\.0\.0 modificado/);
  expect(f).toMatch(/behm ◇\s+main@\w{7} ↓1 1\.0\.0 atrás · 1 comando/);
  expect(f).toMatch(/devm ↯\s+0\.0\.1 dev/);
  expect(f).toMatch(/✗ badm ◇\s+erro: falha na fábrica/);
});

test("catalog: lists what is not installed with the source; empty shows a friendly message", async () => {
  const { t } = await mount();
  await t.press("c");
  expect(t.frame()).toContain("catálogo vazio · fonte: embutido");
  await t.press("c");
  expect(t.frame()).toContain("› módulos");
  h!.destroy();
  const o = origin("gm");
  await install(origin("have"), "have");
  const cat: Catalog = { modules: [{ id: "gm", url: o.url, descricao: "módulo de teste" }, { id: "have", url: "https://x/y", descricao: "já instalado" }], source: "rede", fetchedAt: Date.now() };
  const m = await mount({ catalog: cat });
  await m.t.press("c");
  const f = m.t.frame();
  expect(f).toMatch(/gm ◆\s+módulo de teste/);
  expect(f).not.toContain("já instalado");
  expect(f).toMatch(/fonte: rede · \d\d:\d\d/);
  expect(footer(m.t)).toContain("enter instala");
});

test("catalog enter clones and opens the review; nothing is imported before t; t loads it live (palette sees it)", async () => {
  const o = origin("gm", { permissions: { exec: ["systemctl"], net: ["srv:10051"] } });
  const cat: Catalog = { modules: [{ id: "gm", url: o.url, descricao: "módulo de teste" }], source: "rede", fetchedAt: Date.now() };
  const { t, store } = await mount({ catalog: cat });
  await t.press("c");
  await t.press("RETURN");
  const f = await see(t, (x) => x.includes("revisão de confiança"));
  expect(f).toContain("gm 1.0.0");
  expect(f).toMatch(/exec systemctl/);
  expect(f).toContain("net srv:10051");
  expect(f).toContain("roda como root");
  expect(f).toContain("conflitos");
  expect(existsSync(dirOf("gm"))).toBe(true);
  expect(existsSync(marker)).toBe(false); // cloned, never imported
  expect(footer(t)).toContain("t confiar neste commit");
  await t.press("p"); // só permissões
  expect(t.frame()).toContain("pede permissão");
  expect(t.frame()).not.toContain("origem");
  await t.press("p");
  await t.press("s"); // ver o código
  await see(t, (x) => x.includes("código · só leitura"));
  expect(t.frame()).toContain("index.ts");
  await t.press("RETURN");
  await see(t, (x) => x.includes("export default"));
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("revisão de confiança");
  expect(existsSync(marker)).toBe(false);
  await t.press("t");
  await see(t, (x) => x.includes("gm 1.0.0 carregado · 1 comando"));
  expect(existsSync(marker)).toBe(true);
  expect(registry.commands.has("gm hi")).toBe(true);
  expect(store.blocks.at(-1)).toMatchObject({ line: expect.stringMatching(/^modules trust gm --sha \w{7}$/), status: "ok" });
  await t.press("RETURN"); // back to the tabs
  await t.press("k", { ctrl: true });
  await t.type("gm hi");
  expect(t.frame()).toContain("gm hi");
});

test("update: u shows the new commits and the permission diff; t advances to the approved commit", async () => {
  const o = origin("um");
  await install(o, "um");
  const sha = o.commit({ "pvx-module.json": JSON.stringify({ id: "um", version: "1.1.0", entry: "index.ts", contributes: { commands: ["hi"] }, permissions: { exec: ["rm"] } }) }, "pede rm");
  const { t } = await mount();
  await goto(t, "um");
  await t.press("u");
  const f = await see(t, (x) => x.includes("atualização · um"));
  expect(f).toContain("pede rm");
  expect(f).toContain("ADICIONADAS exec: rm");
  expect(f).toContain("muda as permissões");
  await t.press("t");
  await see(t, (x) => x.includes("um 1.1.0 carregado"));
  expect(sh(dirOf("um"), "rev-parse", "HEAD")).toBe(sha);
  expect(registry.modules.get("um")?.version).toBe("1.1.0");
});

test("x removes after the host confirms; the module leaves the list and the registry at once", async () => {
  await install(origin("rm1"), "rm1");
  const { t } = await mount();
  await see(t, (x) => /rm1.*carregado/.test(x));
  await goto(t, "rm1");
  expect(registry.commands.has("rm1 hi")).toBe(true);
  await t.press("x");
  expect(t.frame()).toContain("confirmar `modules remove rm1`");
  await t.press("n");
  expect(existsSync(dirOf("rm1"))).toBe(true);
  await t.press("RETURN"); // the "cancelado" block
  await t.press("x");
  await t.press("s");
  await see(t, (x) => x.includes("rm1 removido"));
  expect(existsSync(dirOf("rm1"))).toBe(false);
  expect(registry.commands.has("rm1 hi")).toBe(false);
  expect(registry.modules.has("rm1")).toBe(false);
  await t.press("RETURN");
  expect(t.frame()).not.toMatch(/» rm1/);
});

test("d disables and enables live", async () => {
  await install(origin("tg"), "tg");
  const { t } = await mount();
  await see(t, (x) => /tg.*carregado/.test(x));
  await goto(t, "tg");
  await t.press("d");
  await see(t, (x) => x.includes("tg desativado"));
  expect(registry.commands.has("tg hi")).toBe(false);
  await t.press("RETURN");
  await see(t, (x) => /tg.*desativado/.test(x));
  await t.press("d");
  await see(t, (x) => x.includes("tg 1.0.0 carregado"));
  expect(registry.commands.has("tg hi")).toBe(true);
});

test("t on a module awaiting trust reviews it; enter does the same", async () => {
  const o = origin("aw");
  await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
  const { t } = await mount();
  await see(t, (x) => /aw.*aguardando confiança/.test(x));
  await goto(t, "aw");
  expect(footer(t)).toContain("t confia");
  await t.press("t");
  await see(t, (x) => x.includes("revisão de confiança · aw"));
  expect(existsSync(marker)).toBe(false);
});

test("a opens the repository box; a short ref clones and opens the review; esc cancels; errors stay inline", async () => {
  const o = origin("sr");
  const save = { ...process.env };
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${o.url}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = "https://github.com/acme/sr.git";
  try {
    const { t, store } = await mount();
    await t.press("a");
    expect(t.frame()).toContain("repositório:");
    expect(t.frame()).toContain("usuario/repo");
    expect(footer(t)).toContain("enter clona e revisa");
    await t.type("../x");
    await t.press("RETURN");
    await see(t, (x) => x.includes("referência inválida"));
    expect(store.blocks.at(-1)?.status).toBe("error");
    for (let i = 0; i < 4; i++) await t.press("BACKSPACE");
    await t.type("acme/sr");
    await t.press("RETURN");
    const f = await see(t, (x) => x.includes("revisão de confiança"));
    expect(f).toContain("revisão de confiança · sr");
    expect(JSON.stringify(store.blocks.at(-1)?.lines)).toContain("repositório: https://github.com/acme/sr.git"); // git's insteadOf rewrites the review's origin, not this line
    expect(existsSync(dirOf("sr"))).toBe(true);
    expect(existsSync(marker)).toBe(false); // nothing imported before t
    await t.press("ESCAPE");
    await see(t, (x) => !x.includes("revisão de confiança"));
    expect(existsSync(marker)).toBe(false);
    expect(registry.commands.has("sr hi")).toBe(false);
  } finally {
    for (const k of ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) save[k] === undefined ? delete process.env[k] : (process.env[k] = save[k]);
  }
});

/** Makes `acme/<id>` clone from the local origin: a Windows file:// path is not a valid manual-add URL. Returns the ref. */
function shortRef(o: Origin, id: string) {
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${o.url}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = `https://github.com/acme/${id}.git`;
  return `acme/${id}`;
}
afterEach(() => {
  for (const k of ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) delete process.env[k];
});

/** Manual add of `o` up to the incompatibility modal. */
async function addIncompatible(o: Origin, id: string) {
  const m = await mount();
  await m.t.press("a");
  await m.t.type(shortRef(o, id));
  await m.t.press("RETURN");
  const f = await see(m.t, (x) => x.includes("sistema incompatível"));
  expect(f).toContain("não é compatível com este sistema");
  expect(f).toMatch(/\[ Entendi, não instalar \]/);
  expect(f).not.toMatch(/\[ Instalar mesmo assim \]/);
  return m;
}

test("a incompatible module: the modal defaults to not installing; enter refuses and removes the clone", async () => {
  const { t } = await addIncompatible(origin("inc", { distro: ["nonexistent-distro"] }), "inc");
  await t.press("RETURN");
  await see(t, (x) => !x.includes("sistema incompatível") && x.includes("cancelado"));
  expect(existsSync(dirOf("inc"))).toBe(false);
  expect(existsSync(marker)).toBe(false);
});

test("a incompatible module: esc on the modal also cancels", async () => {
  const { t } = await addIncompatible(origin("inc2", { distro: ["nonexistent-distro"] }), "inc2");
  await t.press("ESCAPE");
  await see(t, (x) => !x.includes("sistema incompatível") && x.includes("cancelado"));
  expect(existsSync(dirOf("inc2"))).toBe(false);
});

test("a incompatible module: right then enter installs anyway and the review shows the sistema row", async () => {
  const { t } = await addIncompatible(origin("inc3", { distro: ["nonexistent-distro"] }), "inc3");
  await t.press("ARROW_RIGHT");
  expect(t.frame()).toMatch(/\[ Instalar mesmo assim \]/);
  expect(t.frame()).not.toMatch(/\[ Entendi, não instalar \]/);
  await t.press("RETURN");
  const f = await see(t, (x) => x.includes("revisão de confiança"));
  expect(f).toMatch(/sistema\s+✗/);
  expect(f).toContain("nonexistent-distro");
  expect(existsSync(dirOf("inc3"))).toBe(true);
  expect(existsSync(marker)).toBe(false);
});

test("a compatible module never shows the incompatibility modal", async () => {
  const o = origin("cmp");
  const { t } = await mount();
  await t.press("a");
  await t.type(shortRef(o, "cmp"));
  await t.press("RETURN");
  await see(t, (x) => x.includes("revisão de confiança"));
  expect(t.frame()).not.toContain("sistema incompatível");
  expect(t.frame()).toMatch(/sistema\s+✓/);
});

test("a without root shows the sudo block", async () => {
  const { t, store } = await mount({ isRoot: false });
  await t.press("a");
  await t.type("acme/sr");
  await t.press("RETURN");
  await see(t, (x) => x.includes("rode com sudo"));
  expect(store.blocks.at(-1)?.status).toBe("error");
});

test("without root an action is blocked with the sudo block; viewing works", async () => {
  await install(origin("nr"), "nr");
  const { t, store } = await mount({ isRoot: false });
  await see(t, (x) => /nr.*carregado/.test(x));
  await goto(t, "nr");
  await t.press("d");
  expect(t.frame()).toContain("rode com sudo");
  expect(store.blocks.at(-1)?.status).toBe("error");
  expect(registry.commands.has("nr hi")).toBe(true);
});

test("the background check puts ↓n on the Módulos tab and in the row", async () => {
  await install(origin("pm"), "pm");
  const { t } = await mount({ pending: [{ id: "pm", behind: 2 }] });
  await see(t, (x) => /Módulos ↓1/.test(x));
  expect(t.frame()).toMatch(/pm ◇\s+main@\w{7} ↓2 1\.0\.0 atrás/);
});

for (const [cols, rows] of [[80, 24], [120, 40]] as const) {
  test(`layout ${cols}x${rows}: the list and the review screen fit and keep the footer`, async () => {
    const o = origin("lay", { permissions: { exec: ["systemctl"] } });
    await install(origin("lst"), "lst");
    await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
    const { t } = await mount({ cols, rows });
    await see(t, (x) => /lay.*aguardando confiança/.test(x));
    const fit = () => {
      const lines = t.frame().split("\n");
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(cols);
      expect(lines.some((l) => l.includes("╭"))).toBe(true);
      expect(lines.some((l) => l.includes("╰"))).toBe(true);
    };
    fit();
    expect(footer(t)).toContain("? ajuda");
    await goto(t, "lay");
    expect(footer(t)).toContain("t confia");
    expect(footer(t)).toContain("? ajuda");
    await t.press("RETURN");
    await see(t, (x) => x.includes("revisão de confiança"));
    fit();
    expect(t.frame()).toContain("roda como root");
    expect(footer(t)).toContain("t confiar neste commit");
    expect(footer(t)).toContain("? ajuda");
  });
}
