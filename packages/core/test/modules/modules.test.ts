import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@pvx/sdk";
import { addModule, createRegistry, listModules, listTrust, loadModules, pendingUpdates, reloadModule, runCli, trustGate, watchDevModules, type CliIO, type DevEvent } from "../../src/index.ts";

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

  test("a symlink is dev only when `modules link` recorded it: loads without trust", async () => {
    const o = origin("devm");
    expect((await cli(`modules link ${o.work}`)).code).toBe(0);
    expect(await states()).toEqual({ devm: "dev" });
    expect(existsSync(marker)).toBe(true);
  });

  test("an unregistered symlink is never imported", async () => {
    const o = origin("devm");
    mkdirSync(process.env.PVX_USERMODULES!, { recursive: true });
    symlinkSync(o.work, modDir("devm"));
    expect(await states()).toEqual({ devm: "aguardando-confianca" });
    const row = (await listModules(await load()))[0]!;
    expect(row.error).toContain("use pvx modules link");
    expect([...(await load()).modules.keys()]).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  test("a recorded link that now points elsewhere does not load", async () => {
    const a = origin("devm");
    const b = origin("devm", {}, "other");
    await cli(`modules link ${a.work}`);
    rmSync(modDir("devm"));
    symlinkSync(b.work, modDir("devm"));
    expect(await states()).toEqual({ devm: "aguardando-confianca" });
    expect(existsSync(marker)).toBe(false);
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

const head = (dir: string) => sh(dir, "rev-parse", "HEAD");
const trusted = async (id = "gm", extra: Record<string, unknown> = {}) => {
  const o = origin(id, extra);
  await add(o.url, { trust: head(o.work) });
  return o;
};
const manifestOf = (id: string, permissions: Record<string, string[]>) => JSON.stringify({ id, version: "1.0.0", entry: "index.ts", contributes: { commands: ["hi"] }, permissions });

describe("update", () => {
  test("nothing new: já está atualizado, exit 0, nothing redone", async () => {
    const o = await trusted();
    const before = listTrust().gm!;
    const r = await cli("modules update gm");
    expect(r).toMatchObject({ code: 0, text: "[✓] gm: já está atualizado" });
    expect(head(modDir())).toBe(head(o.work));
    expect(listTrust().gm).toEqual(before);
  });

  test("a new commit without --trust stays on the approved sha, state atras", async () => {
    const o = await trusted();
    const old = head(modDir());
    const fresh = o.commit({ "x.txt": "x" }, "adiciona x");
    const r = await cli("modules update gm");
    expect(r.code).toBe(0);
    expect(r.text).toContain("1 commit(s) novo(s)");
    expect(r.text).toContain(`${fresh.slice(0, 7)} adiciona x`);
    expect(r.text).toContain(`modules update gm --trust ${fresh.slice(0, 7)}`);
    expect(head(modDir())).toBe(old);
    expect((await listModules(await load()))[0]).toMatchObject({ state: "atras", behind: 1 });
  });

  test("--trust pulls, approves the new sha and loads", async () => {
    const o = await trusted();
    const fresh = o.commit({ "x.txt": "x" });
    expect((await cli("modules update gm --trust deadbeefdeadbeef")).code).toBe(1);
    expect(head(modDir())).not.toBe(fresh);
    const r = await cli(`modules update gm --trust ${fresh}`);
    expect(r.code).toBe(0);
    expect(r.text).toContain("atualizado e aprovado");
    expect(head(modDir())).toBe(fresh);
    expect(listTrust().gm!.sha).toBe(fresh);
    expect(await states()).toEqual({ gm: "carregado" });
    expect((await cli("modules update gm")).text).toContain("já está atualizado");
  });

  test("the permission diff highlights added and removed exec/net/fs", async () => {
    const o = await trusted("gm", { permissions: { exec: ["ls", "cat"], fs: ["/etc"] } });
    o.commit({ "pvx-module.json": manifestOf("gm", { exec: ["cat", "curl"], net: ["x.com"] }) });
    const r = await cli("modules update gm");
    expect(r.text).toContain("permissões ADICIONADAS (exec): curl");
    expect(r.text).toContain("permissões ADICIONADAS (net): x.com");
    expect(r.text).toContain("permissões removidas (exec): ls");
    expect(r.text).toContain("permissões removidas (fs): /etc");
    expect(r.text).not.toContain("cat,");
  });

  test("a diverged history is refused as non-fast-forward", async () => {
    const o = await trusted();
    const fresh = o.commit({ "x.txt": "x" });
    writeFileSync(join(modDir(), "local.txt"), "l");
    sh(modDir(), "add", "-A");
    sh(modDir(), "commit", "-q", "-m", "local");
    const r = await cli(`modules update gm --trust ${fresh}`);
    expect(r.code).toBe(1);
    expect(r.text).toContain("não é fast-forward");
  });

  test("a dirty tree refuses the pull", async () => {
    const o = await trusted();
    const fresh = o.commit({ "x.txt": "x" });
    writeFileSync(join(modDir(), "junk"), "j");
    const r = await cli(`modules update gm --trust ${fresh}`);
    expect(r.code).toBe(1);
    expect(r.text).toContain("árvore alterada");
  });

  test("--all and a dev link", async () => {
    await trusted();
    const dev = origin("dv");
    await cli(`modules link ${dev.work}`);
    expect((await cli("modules update --all")).text).toBe("[✓] gm: já está atualizado");
    expect((await cli("modules update dv")).code).toBe(1);
    expect((await cli("modules update")).code).toBe(2);
  });
});

describe("update-notice cache", () => {
  const cache = () => join(process.env.PVX_HOME!, "update-check.json");
  test("TTL: a fresh cache is used, an expired one refetches", async () => {
    const o = await trusted();
    o.commit({ "a.txt": "a" });
    const t0 = Date.now();
    expect(await pendingUpdates({ allowFile: true, now: t0 })).toEqual([{ id: "gm", behind: 1 }]);
    o.commit({ "b.txt": "b" });
    expect(await pendingUpdates({ allowFile: true, now: t0 + 3600_000 })).toEqual([{ id: "gm", behind: 1 }]); // cached
    expect(await pendingUpdates({ allowFile: true, now: t0 + 7 * 3600_000 })).toEqual([{ id: "gm", behind: 2 }]);
  });

  test("offline: silent, no throw", async () => {
    await trusted();
    rmSync(join(tmp, "gm.git"), { recursive: true });
    expect(await pendingUpdates({ allowFile: true })).toEqual([]);
  });

  test("add, update and remove invalidate it", async () => {
    const o = await trusted();
    const fill = async () => (o.commit({ [`f${Math.random()}`]: "x" }), await pendingUpdates({ allowFile: true }), expect(existsSync(cache())).toBe(true));
    await fill();
    await add(origin("other").url);
    expect(existsSync(cache())).toBe(false);
    await pendingUpdates({ allowFile: true });
    await cli("modules update gm");
    expect(existsSync(cache())).toBe(false);
    await pendingUpdates({ allowFile: true });
    expect((await cli("modules remove other --yes")).code).toBe(0);
    expect(existsSync(cache())).toBe(false);
  });
});

describe("link and reload", () => {
  /** A dev module with a helper file: reload must re-evaluate relative imports too. */
  function devModule() {
    const dir = join(tmp, "dev-work");
    mkdirSync(dir);
    writeFileSync(join(dir, "pvx-module.json"), JSON.stringify({ id: "dv", version: "1.0.0", entry: "index.ts" }));
    writeFileSync(join(dir, "helper.ts"), 'export const word = "v1";\n');
    writeFileSync(join(dir, "index.ts"), 'import { word } from "./helper.ts";\nexport default () => ({ commands: { hi: { help: "h", run: (c: any) => c.out.success(word) } } });\n');
    return dir;
  }
  const opts = { hostVersion: "1.0.0", makeLogger };
  const say = async (registry: ReturnType<typeof createRegistry>) => (await cli("dv hi", { registry })).text;

  test("link warns, records dev, remove drops the link and the record but not the target", async () => {
    const dir = devModule();
    const r = await cli(`modules link ${dir}`);
    expect(r.code).toBe(0);
    expect(r.text).toContain("sem confiança por commit");
    expect(await states()).toEqual({ dv: "dev" });
    expect(readFileSync(join(process.env.PVX_HOME!, "modules.json"), "utf8")).toContain('"dv"');
    expect((await cli(`modules link ${dir}`)).text).toContain("já linkado");
    expect((await cli("modules remove dv --yes")).code).toBe(0);
    expect(existsSync(modDir("dv"))).toBe(false);
    expect(existsSync(join(dir, "helper.ts"))).toBe(true);
    expect(JSON.parse(readFileSync(join(process.env.PVX_HOME!, "modules.json"), "utf8")).dev).toEqual([]);
  });

  test("reload picks up an edit (also in a relative import); a broken edit keeps the old version", async () => {
    const dir = devModule();
    await cli(`modules link ${dir}`);
    const registry = await load();
    expect(await say(registry)).toBe("[✓] v1");
    writeFileSync(join(dir, "helper.ts"), 'export const word = "v2";\n');
    expect(await reloadModule(registry, "dv", opts)).toEqual({ ok: true, text: "dv recarregado" });
    expect(await say(registry)).toBe("[✓] v2");
    writeFileSync(join(dir, "helper.ts"), "export const word = ;\n");
    const bad = await reloadModule(registry, "dv", opts);
    expect(bad.ok).toBe(false);
    expect(await say(registry)).toBe("[✓] v2");
    expect(registry.errors).toEqual([]);
    writeFileSync(join(dir, "helper.ts"), 'export const word = "v3";\n');
    expect((await reloadModule(registry, "dv", opts)).ok).toBe(true);
    expect(await say(registry)).toBe("[✓] v3");
  });

  test("reload replaces commands (a removed command disappears) and refuses non-dev modules", async () => {
    const dir = devModule();
    await cli(`modules link ${dir}`);
    const registry = await load();
    writeFileSync(join(dir, "index.ts"), 'export default () => ({ commands: { other: { help: "h", run: (c: any) => c.out.success("o") } } });\n');
    await reloadModule(registry, "dv", opts);
    expect([...registry.commands.keys()]).toEqual(["dv other"]);
    await trusted();
    expect((await reloadModule(await load(), "gm", opts)).ok).toBe(false);
  });

  test("the watcher reloads on save and reports a load error as an event", async () => {
    const dir = devModule();
    await cli(`modules link ${dir}`);
    const registry = await load();
    const events: DevEvent[] = [];
    const stop = watchDevModules(registry, (e) => events.push(e), { ...opts, debounceMs: 20, pollMs: 50 });
    const until = async (n: number) => {
      for (let i = 0; i < 100 && events.length < n; i++) await Bun.sleep(50);
      expect(events.length).toBeGreaterThanOrEqual(n);
    };
    try {
      await Bun.sleep(100);
      writeFileSync(join(dir, "helper.ts"), 'export const word = "w2";\n');
      await until(1);
      expect(events.at(-1)).toEqual({ id: "dv", result: { ok: true, text: "dv recarregado" } });
      expect(await say(registry)).toBe("[✓] w2");
      writeFileSync(join(dir, "helper.ts"), "export const word = ;\n");
      await until(events.length + 1);
      expect(events.at(-1)!.result.ok).toBe(false);
      expect(await say(registry)).toBe("[✓] w2");
    } finally {
      stop();
    }
  });
});
