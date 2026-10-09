import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@pvx/sdk";
import { addModule, createRegistry, listModules, loadModules, runCli, trustGate, type CliIO } from "../../src/index.ts";

const noop = () => {};
const makeLogger = (): Logger => ({ debug: noop, info: noop, warn: noop, error: noop });
const theme = { text: "#fff", accent: "#0f0", warn: "#ff0", error: "#f00", info: "#00f" };

let tmp = "";
let marker = "";
const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pvx-git-"));
  process.env.PVX_USERMODULES = join(process.env.PVX_HOME!, "usermodules");
  marker = join(tmp, "marker");
  process.env.PVX_TEST_MARKER = marker;
});
afterEach(() => {
  delete process.env.PVX_TEST_MARKER;
  rmSync(tmp, { recursive: true, force: true });
});

interface Origin {
  url: string;
  work: string;
  commit(files: Record<string, string>, message?: string): string;
}
/** A work repo pushing to a bare origin; the module writes PVX_TEST_MARKER at import time. */
function origin(id = "gm", extra: Record<string, unknown> = {}, name = id): Origin {
  const work = join(tmp, `${name}-work`);
  const bare = join(tmp, `${name}.git`);
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
  const manifest = { id, version: "1.0.0", entry: "index.ts", contributes: { commands: ["hi"] }, ...extra };
  writeFileSync(
    join(work, "index.ts"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.PVX_TEST_MARKER!, "imported");\nexport default () => ({ commands: { hi: { help: "hi", run: (ctx: any) => ctx.out.success("oi de ${id}") } } });\n`,
  );
  writeFileSync(join(work, "pvx-module.json"), JSON.stringify(manifest));
  sh(work, "add", "-A");
  sh(work, "commit", "-q", "-m", "init");
  sh(tmp, "clone", "-q", "--bare", work, bare);
  sh(work, "remote", "add", "origin", bare);
  return o;
}

const add = (url: string, o: Partial<Parameters<typeof addModule>[1]> = {}) => addModule(url, { hostVersion: "1.0.0", allowFile: true, ...o });
const modDir = (id = "gm") => join(process.env.PVX_USERMODULES!, id);
async function load() {
  const registry = createRegistry();
  await loadModules(registry, { hostVersion: "1.0.0", makeLogger, canImport: trustGate() });
  return registry;
}
async function cli(line: string, over: Partial<CliIO> = {}) {
  const out: string[] = [];
  const code = await runCli({
    argv: line.split(" ").filter(Boolean),
    env: { NO_COLOR: "1" },
    isTTY: false,
    isRoot: true,
    registry: over.registry ?? createRegistry(),
    makeLogger,
    profilesDir: join(tmp, "profiles"),
    version: "1.0.0",
    theme,
    allowFile: true,
    out: (l) => out.push(l),
    ...over,
  });
  return { code: code as number, out, text: out.join("\n") };
}
const states = async () => Object.fromEntries((await listModules(await load())).map((r) => [r.id, r.state]));

describe("add and trust", () => {
  test("add --trust: loads and its command runs", async () => {
    const o = origin();
    const head = sh(o.work, "rev-parse", "HEAD");
    const r = await add(o.url, { trust: head });
    expect(r).toMatchObject({ ok: true, status: "instalado", id: "gm", state: "carregado" });
    const registry = await load();
    expect((await cli("gm hi", { registry })).text).toBe("[✓] oi de gm");
    expect(await states()).toEqual({ gm: "carregado" });
  });

  test("add without trust never imports the module (marker file)", async () => {
    const o = origin();
    const r = await add(o.url);
    expect(r).toMatchObject({ ok: true, state: "aguardando-confianca" });
    expect(await states()).toEqual({ gm: "aguardando-confianca" });
    expect(existsSync(marker)).toBe(false);
    expect([...(await load()).modules.keys()]).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  test("a trust sha that does not match HEAD refuses and leaves nothing installed", async () => {
    const o = origin();
    const r = await add(o.url, { trust: "deadbeefdeadbeef" });
    expect(r.ok).toBe(false);
    expect(existsSync(modDir())).toBe(false);
  });

  test("trust through the CLI approves, then the module loads", async () => {
    const o = origin();
    const added = await cli(`modules add ${o.url}`);
    expect(added.code).toBe(0);
    expect(added.text).toContain("pvx modules trust gm --sha");
    expect(added.text).toContain("roda como root");
    expect(existsSync(marker)).toBe(false);
    const head = sh(o.work, "rev-parse", "HEAD");
    expect((await cli(`modules trust gm --sha ${head}`)).code).toBe(0);
    expect(await states()).toEqual({ gm: "carregado" });
    const list = await cli("modules trust --list");
    expect(list.text).toContain(`gm ${head.slice(0, 7)}`);
    expect((await cli("modules trust --revoke gm")).code).toBe(0);
    expect(await states()).toEqual({ gm: "aguardando-confianca" });
    expect((await cli("modules trust --list")).text).toContain("nenhuma aprovação");
  });

  test("add twice says já instalado, exit 0", async () => {
    const o = origin();
    await add(o.url);
    const again = await cli(`modules add ${o.url}`);
    expect(again.code).toBe(0);
    expect(again.text).toContain("já instalado");
  });
});

describe("gate", () => {
  async function trusted() {
    const o = origin();
    await add(o.url, { trust: sh(o.work, "rev-parse", "HEAD") });
    return o;
  }

  test("a dirty tree is modificado and does not load", async () => {
    await trusted();
    writeFileSync(join(modDir(), "index.ts"), "export default () => ({})");
    expect(await states()).toEqual({ gm: "modificado" });
    expect([...(await load()).modules.keys()]).toEqual([]);
  });

  test("a new commit pulled by hand without approval does not load", async () => {
    const o = await trusted();
    o.commit({ "extra.txt": "x" });
    sh(modDir(), "pull", "-q", "--ff-only");
    expect(await states()).toEqual({ gm: "aguardando-confianca" });
    expect([...(await load()).modules.keys()]).toEqual([]);
  });

  test("atras with behind count only from fetched data", async () => {
    const o = await trusted();
    o.commit({ "extra.txt": "x" });
    let row = (await listModules(await load()))[0]!;
    expect(row.state).toBe("carregado"); // nothing fetched yet: never fetched at load
    sh(modDir(), "fetch", "-q");
    row = (await listModules(await load()))[0]!;
    expect(row).toMatchObject({ state: "atras", behind: 1 });
  });

  test("disable and enable", async () => {
    await trusted();
    expect((await cli("modules disable gm")).code).toBe(0);
    expect(await states()).toEqual({ gm: "desativado" });
    expect([...(await load()).modules.keys()]).toEqual([]);
    expect((await cli("modules enable gm")).code).toBe(0);
    expect(await states()).toEqual({ gm: "carregado" });
  });

  test("a symlink is dev: loads without trust", async () => {
    const o = origin("devm");
    mkdirSync(process.env.PVX_USERMODULES!, { recursive: true });
    symlinkSync(o.work, modDir("devm"));
    expect(await states()).toEqual({ devm: "dev" });
    expect(existsSync(marker)).toBe(true);
  });

  test("an entry that escapes through a symlink is an error", async () => {
    const o = origin("esc", { entry: "out.ts" });
    writeFileSync(join(tmp, "outside.ts"), "export default () => ({})");
    symlinkSync(join(tmp, "outside.ts"), join(o.work, "out.ts"));
    sh(o.work, "add", "-A");
    sh(o.work, "commit", "-q", "-m", "link");
    sh(o.work, "push", "-q", "origin", "main");
    await add(o.url, { trust: sh(o.work, "rev-parse", "HEAD") });
    const rows = await listModules(await load());
    expect(rows[0]).toMatchObject({ id: "esc", state: "erro" });
    expect(rows[0]!.error).toContain("fora do diretório");
  });
});

describe("remove", () => {
  test("keeps the state, --purge removes it", async () => {
    const o = origin();
    await add(o.url, { trust: sh(o.work, "rev-parse", "HEAD") });
    const state = join(process.env.PVX_HOME!, "modules/gm/state");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "k"), "v");
    expect((await cli("modules remove gm")).code).toBe(2); // no --yes outside a terminal
    const r = await cli("modules remove gm --yes");
    expect(r.code).toBe(0);
    expect(existsSync(modDir())).toBe(false);
    expect(existsSync(join(state, "k"))).toBe(true);
    expect((await cli("modules trust --list")).text).toContain("nenhuma aprovação");
    const again = origin("gm", {}, "gm2");
    await add(again.url);
    expect((await cli("modules remove gm --purge --yes")).code).toBe(0);
    expect(existsSync(join(process.env.PVX_HOME!, "modules/gm"))).toBe(false);
  });

  test("an id that is not a plain slug is refused", async () => {
    expect((await cli("modules remove ../x --yes")).code).toBe(1);
  });
});

describe("conflicts and bad input", () => {
  test("an id collision refuses the add and names both", async () => {
    const a = origin("gm");
    await add(a.url, { trust: sh(a.work, "rev-parse", "HEAD") });
    const registry = await load();
    const b = origin("gm", {}, "other");
    const r = await add(b.url, { registry });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain('"gm"');
    expect((r as { error: string }).error).toContain("já pertence");
    expect(existsSync(join(process.env.PVX_USERMODULES!, ".add-x"))).toBe(false);
  });

  test("a module id equal to a core command is refused", async () => {
    const o = origin("logs");
    const r = await cli(`modules add ${o.url}`);
    expect(r.code).toBe(1);
    expect(r.text).toContain("comando do núcleo");
  });

  test("bad schemes are rejected; file:// only with allowFile", async () => {
    for (const u of ["http://x/y.git", "ftp://x/y", "git://x/y", "ext::sh -c id", "--upload-pack=x", "https://user:pw@h/r.git"]) {
      expect((await add(u)).ok).toBe(false);
    }
    const o = origin();
    const denied = await addModule(o.url, { hostVersion: "1.0.0" });
    expect(denied.ok).toBe(false);
    expect((denied as { error: string }).error).toContain("esquema não permitido");
    expect((await add(o.url)).ok).toBe(true);
  });

  test("a git failure is a readable error, exit 1, no stack", async () => {
    const r = await cli(`modules add file://${tmp}/nope.git`);
    expect(r.code).toBe(1);
    expect(r.text).toContain("git clone falhou");
    expect(r.text).not.toContain("    at ");
  });

  test("hooks do not run on clone", async () => {
    const tpl = join(tmp, "tpl");
    mkdirSync(join(tpl, "hooks"), { recursive: true });
    const hook = join(tpl, "hooks/post-checkout");
    writeFileSync(hook, `#!/bin/sh\necho hook > ${marker}\n`);
    chmodSync(hook, 0o755);
    const o = origin();
    process.env.GIT_TEMPLATE_DIR = tpl;
    try {
      // control: a plain clone does run the hook, so the test can fail
      sh(tmp, "clone", "-q", o.url.replace("file://", ""), join(tmp, "control"));
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);
      expect((await add(o.url)).ok).toBe(true);
      expect(existsSync(marker)).toBe(false);
    } finally {
      delete process.env.GIT_TEMPLATE_DIR;
    }
  });
});

describe("review and list", () => {
  test("static analysis warnings, permissions and --json states", async () => {
    const o = origin("gm", { permissions: { exec: ["ls"] } });
    o.commit({ "evil.ts": 'import { exec } from "node:child_process";\nBun.spawn(["x"]);\nfetch("http://x");\n' });
    const r = await cli(`modules add ${o.url}`);
    expect(r.text).toContain("análise estática: evil.ts:1: usa child_process");
    expect(r.text).toContain("evil.ts:2: usa Bun.spawn");
    expect(r.text).toContain("evil.ts:3: chama fetch(");
    expect(r.text).toContain("exec ls");
    const j = await cli("modules list --json", { registry: await load() });
    const parsed = JSON.parse(j.text);
    expect(parsed.lines[0].module).toMatchObject({ id: "gm", state: "aguardando-confianca" });
  });

  test("an id the manifest does not declare is an error (expectId)", async () => {
    const o = origin();
    const r = await add(o.url, { expectId: "other" });
    expect(r.ok).toBe(false);
    expect(existsSync(modDir())).toBe(false);
  });
});

describe("catalog id", () => {
  test("modules add <id> resolves through PVX_CATALOG_URL", async () => {
    const o = origin();
    // The catalog only accepts https/ssh URLs; git rewrites this one to the local bare repo.
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ version: 1, modules: [{ id: "gm", url: "https://example.test/gm.git", descricao: "d" }] }),
    });
    const save = { ...process.env };
    process.env.PVX_CATALOG_URL = `http://localhost:${server.port}/catalog.json`;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = `url.${o.url}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = "https://example.test/gm.git";
    try {
      const r = await cli("modules add gm");
      expect(r.code).toBe(0);
      expect(r.text).toContain("gm instalado");
      expect(existsSync(modDir())).toBe(true);
      expect((await cli("modules add nao-existe")).code).toBe(2);
    } finally {
      server.stop(true);
      for (const k of ["PVX_CATALOG_URL", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) save[k] === undefined ? delete process.env[k] : (process.env[k] = save[k]);
    }
  });
});
