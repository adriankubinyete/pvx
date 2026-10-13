import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addModule, listTrust, createLogger, createRegistry, linkModule, loadModules, logsDir, pvxHome, runCapture, setEnabled, trustGate, type Catalog, type LoadOpts, type Pending, type Registry } from "@pvx/core";
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
      for (const [f, c] of Object.entries(files)) {
        mkdirSync(dirname(join(work, f)), { recursive: true });
        writeFileSync(join(work, f), c);
      }
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

test("manual add clones and opens the review; nothing is imported before t; t loads it live (palette sees it)", async () => {
  const o = origin("gm", { permissions: { exec: ["systemctl"], net: ["srv:10051"] } });
  const { t, store } = await mount();
  await t.press("a");
  await t.type(shortRef(o, "gm"));
  await t.press("RETURN");
  const f = await see(t, (x) => x.includes("revisão de confiança"));
  expect(f).toContain("gm 1.0.0");
  expect(f).toContain("srv:10051");
  expect(f).toContain("roda como root");
  expect(f).toContain("sem conflitos");
  expect(existsSync(dirOf("gm"))).toBe(true);
  expect(existsSync(marker)).toBe(false); // cloned, never imported
  expect(footer(t)).toContain("t confiar em");
  await t.press("p"); // só permissões
  expect(t.frame()).toContain("pede permissão");
  expect(t.frame()).toContain("exec systemctl");
  expect(t.frame()).toContain("net srv:10051");
  expect(t.frame()).not.toContain("primeira aprovação");
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

test("catalog enter installs trusted always: no review screen, the module loads and the row shows ∞ sempre", async () => {
  const o = origin("gm");
  const cat: Catalog = { modules: [{ id: "gm", url: o.url, descricao: "módulo de teste" }], source: "rede", fetchedAt: Date.now() };
  const { t, store } = await mount({ catalog: cat });
  await t.press("c");
  await t.press("RETURN");
  const f = await see(t, (x) => x.includes("gm 1.0.0 carregado"));
  expect(f).not.toContain("revisão de confiança");
  expect(f).toContain("instalado do catálogo: confiança sempre");
  expect(listTrust().gm?.always).toBe(true);
  expect(registry.commands.has("gm hi")).toBe(true);
  expect(store.blocks.at(-1)).toMatchObject({ line: "modules add gm", status: "ok" });
  await t.press("RETURN");
  await t.press("c");
  await see(t, (x) => /gm ◇.*∞ sempre.*carregado/.test(x));
});

test("a manual URL equal to a catalog entry installs the same way; one outside the catalog keeps the review", async () => {
  const o = origin("cm");
  const cat: Catalog = { modules: [{ id: "cm", url: "https://github.com/acme/cm.git", descricao: "x" }], source: "rede", fetchedAt: Date.now() };
  const { t } = await mount({ catalog: cat });
  await t.press("a");
  await t.type(shortRef(o, "cm"));
  await t.press("RETURN");
  const f = await see(t, (x) => x.includes("cm 1.0.0 carregado"));
  expect(f).not.toContain("revisão de confiança");
  expect(listTrust().cm?.always).toBe(true);
  h!.destroy();
  const other = origin("om");
  const m = await mount({ catalog: cat });
  await m.t.press("a");
  await m.t.type(shortRef(other, "om"));
  await m.t.press("RETURN");
  await see(m.t, (x) => x.includes("revisão de confiança · om"));
  expect(listTrust().om).toBeUndefined();
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
  expect(f).toMatch(/✗ só .*nonexistent-distro.* aqui é /);
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
  expect(t.frame()).toContain("✓ qualquer sistema");
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
    expect(footer(t)).toContain("↑↓ arquivo");
    expect(footer(t)).toContain(cols >= 120 ? "? ajuda" : "enter editor"); // the review footer needs ~108 columns
    expect(t.frame()).toContain("arquivos");
  });
}

const FILLER = Array.from({ length: 80 }, (_, i) => `// filler ${i + 1}`);
/** A module with a used lib file (a hit on line 60), an unused one (a hit too) and a distinctive source line. */
function rich(id: string, extra: Record<string, unknown> = {}): Origin {
  const o = origin(id, { permissions: { exec: ["systemctl", "sh"], net: ["srv:10051"] }, contributes: { commands: ["hi"], pages: ["main"] }, ...extra });
  const util = [...FILLER];
  util[9] = `export const SECRET = "SECRET_DISTINCT_LINE_xyz";`;
  util[59] = `export const run = () => Bun.spawn(["true"]);`;
  o.commit({
    "index.ts": `import { writeFileSync } from "node:fs";\nimport { SECRET } from "./lib/util.ts";\nwriteFileSync(process.env.PVX_TEST_MARKER!, "imported");\nexport default () => ({ commands: { hi: { help: "hi", run: (ctx: any) => ctx.out.success(SECRET) } } });\n`,
    ...(Object.fromEntries([["lib/util.ts", util.join("\n") + "\n"], ["lib/dead.ts", `import cp from "child_process";\nexport default cp;\n`]])),
  }, "feat: rich fixture");
  return o;
}
async function openReview(id: string, o: MountOpts = {}) {
  const m = await mount(o);
  await see(m.t, (x) => new RegExp(`${id}.*aguardando confiança`).test(x));
  await goto(m.t, id);
  await m.t.press("t");
  await see(m.t, (x) => x.includes(`revisão de confiança · ${id}`) && x.includes("arquivos"));
  return m;
}

test("review banner: short sha, subject, author, branch and the first-approval mark", async () => {
  const o = rich("bn");
  await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
  const sha = sh(o.work, "rev-parse", "HEAD");
  const { t } = await openReview("bn");
  const f = t.frame();
  expect(f).toContain(sha.slice(0, 7));
  expect(f).toContain("feat: rich fixture");
  expect(f).toContain("t · "); // author
  expect(f).toContain("(hoje)");
  expect(f).toContain("2 commits no histórico");
  expect(f).toContain("primeira aprovação");
  expect(f).toContain("branch main");
  expect(f).toContain("✓ pvx qualquer versão");
  expect(f).toContain("▲ exec sh");
  expect(f).toContain("srv:10051");
  expect(f).toMatch(/entrega\s+1 comando · 1 página/);
});

test("review files: group headers, entry tag, hit counts; ↓ changes the detalhes panel", async () => {
  const o = rich("fl");
  await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
  const { t } = await openReview("fl");
  let f = t.frame();
  expect(f).toContain("arquivos ●");
  expect(f).toContain("3 arquivos · 86 linhas");
  expect(f).toMatch(/▾ \(raiz\)\s+1 · 4 linhas\s+▲ 1 aviso/);
  expect(f).toMatch(/▾ lib\/\s+2 · 82 linhas\s+▲ 2 avisos/);
  expect(f).toMatch(/» index\.ts\s+4\s+entry ▲ 1/);
  expect(f).toMatch(/detalhes · index\.ts/);
  expect(f).toMatch(/importado por\s+ninguém/);
  expect(f).toMatch(/módulo usa\?\s+sim \(entry\)/);
  expect(f).toContain("enter abre no editor na linha 3");
  await t.press("ARROW_DOWN");
  f = t.frame();
  expect(f).toMatch(/» util\.ts\s+80\s+▲ 1/);
  expect(f).toMatch(/detalhes · lib\/util\.ts/);
  expect(f).toMatch(/importado por\s+index\.ts/);
  expect(f).toMatch(/módulo usa\?\s+sim\s*│/);
  expect(f).toContain("▲ usa Bun.spawn");
  expect(f).toContain("linha 60");
  expect(f).toMatch(/1 ─+●─+ 80/);
  expect(f).toContain("enter abre no editor na linha 60");
  await t.press("ARROW_DOWN");
  f = t.frame();
  expect(f).toMatch(/detalhes · lib\/dead\.ts/);
  expect(f).toMatch(/módulo usa\?\s+não · fora do caminho do entry/);
  await t.press("ARROW_DOWN"); // last one: stays
  expect(t.frame()).toMatch(/» dead\.ts/);
});

test("the review never shows source code", async () => {
  const o = rich("ns");
  await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
  const { t } = await openReview("ns");
  for (let i = 0; i < 3; i++) {
    const f = t.frame();
    for (const code of ["SECRET_DISTINCT_LINE_xyz", "Bun.spawn([", "export default", "writeFileSync(process", "import cp from", "// filler"]) expect(f).not.toContain(code);
    await t.press("ARROW_DOWN");
  }
  await t.press("p");
  expect(t.frame()).not.toContain("SECRET_DISTINCT_LINE_xyz");
});

test("enter opens the editor at the first hit line with the hits marked; esc returns to the review", async () => {
  const o = rich("ed");
  await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
  const { t } = await openReview("ed");
  await t.press("ARROW_DOWN"); // lib/util.ts: hit on line 60
  await t.press("RETURN");
  const f = await see(t, (x) => x.includes("lib/util.ts") && x.includes("export const run"));
  expect(f).toMatch(/60 ▲ export const run = \(\) => Bun\.spawn/);
  expect(f).not.toContain("SECRET_DISTINCT_LINE_xyz"); // line 10: scrolled past
  expect(f).not.toContain("revisão de confiança");
  await t.press("ESCAPE");
  const back = await see(t, (x) => x.includes("revisão de confiança · ed"));
  expect(back).toContain("» util.ts"); // same selection
  expect(back).not.toContain("export const run");
  await t.press("s"); // the plain file list still works and opens a file with its marks
  await see(t, (x) => x.includes("código · só leitura"));
  await t.press("RETURN");
  await see(t, (x) => x.includes("writeFileSync"));
  expect(t.frame()).toMatch(/3 ▲ writeFileSync\(process/);
  await t.press("ESCAPE"); // to the list, then to the review
  await t.press("ESCAPE");
  expect(t.frame()).toContain("revisão de confiança · ed");
});

test("T trusts always: the trust entry says so, the module loads and the list shows ∞ sempre", async () => {
  const o = rich("al", { contributes: { commands: ["hi"] } });
  await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
  const { t, store } = await openReview("al");
  expect(footer(t)).toContain("T confiar sempre");
  await t.type("T");
  await see(t, (x) => x.includes("al 1.0.0 carregado"));
  expect(listTrust().al?.always).toBe(true);
  expect(registry.commands.has("al hi")).toBe(true);
  expect(store.blocks.at(-1)).toMatchObject({ line: expect.stringMatching(/^modules trust al --sha \w{7} --always$/), status: "ok" });
  await t.press("RETURN");
  await see(t, (x) => /al ◇.*∞ sempre.*carregado/.test(x));
});

test("an always module updates by itself on u and the result says so", async () => {
  const o = origin("au");
  const r = await addModule(o.url, { hostVersion: "0.1.0", allowFile: true, trust: sh(o.work, "rev-parse", "HEAD"), always: true });
  expect(r.ok).toBe(true);
  const sha = o.commit({ "pvx-module.json": JSON.stringify({ id: "au", version: "1.1.0", entry: "index.ts", contributes: { commands: ["hi"] } }) }, "bump");
  const { t } = await mount();
  await goto(t, "au");
  await t.press("u");
  await see(t, (x) => x.includes("atualizado automaticamente") && x.includes("(confiança sempre)"));
  expect(sh(dirOf("au"), "rev-parse", "HEAD")).toBe(sha);
  expect(registry.modules.get("au")?.version).toBe("1.1.0");
  expect(listTrust().au?.always).toBe(true);
});

test("narrow terminals stack the panels; wide ones put them side by side", async () => {
  const o = rich("nw");
  await addModule(o.url, { hostVersion: "0.1.0", allowFile: true });
  const wide = await openReview("nw", { cols: 120, rows: 40 });
  const row = (f: string, s: string) => f.split("\n").findIndex((l) => l.includes(s));
  expect(row(wide.t.frame(), "arquivos ●")).toBe(row(wide.t.frame(), "detalhes ·"));
  h!.destroy();
  const { t } = await openReview("nw", { cols: 90, rows: 34 });
  const f = t.frame();
  expect(row(f, "detalhes ·")).toBeGreaterThan(row(f, "arquivos ●"));
  for (const l of f.split("\n")) expect(l.length).toBeLessThanOrEqual(90);
  expect(f).toMatch(/importado por/);
});
