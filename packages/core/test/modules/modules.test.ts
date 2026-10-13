import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@pvx/sdk";
import { addModule, createRegistry, listModules, listTrust, loadModules, pendingUpdates, reloadModule, reviewLines, reviewModule, runCli, summarizeCommands, summarizePermissions, trustModule, updateModule, type HostPlatform, trustGate, watchDevModules, type CliIO, type DevEvent } from "../../src/index.ts";

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

describe("system compatibility", () => {
  const win: HostPlatform = { os: "windows", distros: [], name: "Windows" };
  const leftovers = () => (existsSync(process.env.PVX_USERMODULES!) ? readdirSync(process.env.PVX_USERMODULES!) : []);

  test("an incompatible module is refused without a callback, leaving nothing behind", async () => {
    const o = origin("gm", { distro: ["rhel"] });
    const r = await add(o.url, { host: win });
    expect(r).toMatchObject({ ok: false, incompatible: true });
    expect((r as { error: string }).error).toBe("cancelado: feito para linux (rhel); este sistema é Windows");
    expect((r as { review?: { platform: { ok: boolean } } }).review?.platform.ok).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  test("a callback answering false refuses too", async () => {
    const o = origin("gm", { distro: ["rhel"] });
    const r = await add(o.url, { host: win, onIncompatible: async () => false });
    expect(r).toMatchObject({ ok: false, incompatible: true });
    expect((r as { error: string }).error).toStartWith("cancelado:");
    expect(leftovers()).toEqual([]);
  });

  test("a callback answering true installs, awaiting trust, and receives the review", async () => {
    const o = origin("gm", { distro: ["rhel"] });
    let seen: { id: string; platform: { ok: boolean } } | undefined;
    const r = await add(o.url, { host: win, onIncompatible: async (rv) => ((seen = rv), true) });
    expect(r).toMatchObject({ ok: true, status: "instalado", state: "aguardando-confianca" });
    expect(seen).toMatchObject({ id: "gm", platform: { ok: false } });
    expect(leftovers()).toEqual(["gm"]);
  });

  test("a compatible module never calls the callback", async () => {
    const o = origin("gm", { os: ["windows"] });
    let calls = 0;
    const r = await add(o.url, { host: win, onIncompatible: async () => (calls++, false) });
    expect(r).toMatchObject({ ok: true, state: "aguardando-confianca" });
    expect(calls).toBe(0);
  });

  test("the list flags an installed incompatible module and leaves others without the key", async () => {
    await add(origin("gm", { distro: ["rhel"] }).url, { host: win, onIncompatible: async () => true });
    await add(origin("ok").url);
    const rows = await listModules(undefined, win);
    expect(rows.find((r) => r.id === "gm")!.incompatible).toBe("feito para linux (rhel); este sistema é Windows");
    expect("incompatible" in rows.find((r) => r.id === "ok")!).toBe(false);
  });

  test("the review shows the system line", async () => {
    const r = await add(origin("gm", { distro: ["rhel"] }).url, { host: win, onIncompatible: async () => true });
    const lines = reviewLines((r as { review: Parameters<typeof reviewLines>[0] }).review, "x");
    expect(lines.find((l) => l.text.startsWith("sistema:"))).toEqual({ kind: "error", text: "sistema: feito para linux (rhel); este sistema é Windows" });
  });

  test("CLI: refused without --any-os (with a hint), installed with it", async () => {
    const o = origin("gm", { distro: ["nonexistent-distro"] });
    const refused = await cli(`modules add ${o.url}`);
    expect(refused.code).toBe(1);
    expect(refused.text).toContain("cancelado: feito para linux (nonexistent-distro)");
    expect(refused.text).toContain("para instalar mesmo assim, rode de novo com --any-os");
    expect(leftovers()).toEqual([]);
    const forced = await cli(`modules add ${o.url} --any-os`);
    expect(forced.code).toBe(0);
    expect(forced.text).toContain("gm instalado: aguardando-confianca");
    expect(leftovers()).toEqual(["gm"]);
    expect((await cli("modules list")).text).toContain("⚠ sistema");
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

  test("module ids `help` and `h` are refused (the alias is reserved too)", async () => {
    for (const id of ["help", "h"]) {
      const r = await cli(`modules add ${origin(id).url}`);
      expect(r.code).toBe(1);
      expect(r.text).toContain("comando do núcleo");
    }
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
    expect(r.text).toContain("análise estática: evil.ts: linhas 1, 2, 3 (usa child_process, usa Bun.spawn, chama fetch( direto; fora do caminho do entry)");
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

describe("short ref", () => {
  test("modules add user/repo clones from GitHub (rewritten to a local repo) and prints the URL", async () => {
    const o = origin();
    const save = { ...process.env };
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = `url.${o.url}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = "https://github.com/acme/gm.git";
    try {
      const r = await cli("modules add acme/gm");
      expect(r.code).toBe(0);
      expect(r.text).toContain("repositório: https://github.com/acme/gm.git");
      expect(existsSync(modDir())).toBe(true);
      const bad = await cli("modules add acme/../gm");
      expect(bad.code).toBe(2);
      expect(bad.text).toContain("usuario/repositorio");
    } finally {
      for (const k of ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) save[k] === undefined ? delete process.env[k] : (process.env[k] = save[k]);
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

describe("trust always", () => {
  const auditText = () => {
    const f = join(process.env.PVX_HOME!, "audit.jsonl");
    return existsSync(f) ? readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).text).join(" | ") : "";
  };
  const always = async (id = "gm", extra: Record<string, unknown> = {}) => {
    const o = origin(id, extra);
    await add(o.url, { trust: head(o.work), always: true });
    return o;
  };

  test("an always approval is stored, listed, and a plain re-approval clears it", async () => {
    const o = await always();
    expect(listTrust().gm!.always).toBe(true);
    expect((await listModules(await load()))[0]).toMatchObject({ id: "gm", state: "carregado", always: true });
    expect((await cli("modules trust --list")).text).toContain(" sempre");
    expect((await trustModule("gm", head(o.work))).ok).toBe(true);
    expect(listTrust().gm!.always).toBeUndefined();
    expect((await listModules(await load()))[0]).not.toHaveProperty("always");
    expect((await trustModule("gm", head(o.work), { always: true })).ok).toBe(true);
    expect(listTrust().gm!.always).toBe(true);
    expect((await cli("modules trust --revoke gm")).code).toBe(0);
    expect(listTrust().gm).toBeUndefined();
  });

  test("update applies the new commit by itself, audited, adding permissions included", async () => {
    const o = await always("gm", { permissions: { exec: ["ls"] } });
    const fresh = o.commit({ "pvx-module.json": manifestOf("gm", { exec: ["ls", "curl"], net: ["x.com"] }) }, "mais permissões");
    const r = await updateModule("gm", { allowFile: true });
    expect(r).toMatchObject({ ok: true, status: "atualizado", auto: true, sha: fresh });
    if (r.ok) expect(r.check.permissions.added).toEqual({ exec: ["curl"], net: ["x.com"] });
    expect(head(modDir())).toBe(fresh);
    expect(listTrust().gm).toMatchObject({ sha: fresh, always: true, permissions: { exec: ["ls", "curl"], net: ["x.com"] } });
    expect(auditText()).toContain(`trust automático (sempre): gm ${fresh} (${o.url})`);
    expect(await states()).toEqual({ gm: "carregado" });
  });

  test("a changed origin URL is not automatic", async () => {
    const o = await always();
    const old = head(modDir());
    const moved = join(tmp, "moved.git");
    sh(tmp, "clone", "-q", "--bare", join(tmp, "gm.git"), moved);
    const fresh = o.commit({ "x.txt": "x" });
    sh(moved, "fetch", "-q", join(tmp, "gm.git"), "main:main");
    sh(modDir(), "remote", "set-url", "origin", `file://${moved}`);
    const r = await updateModule("gm", { allowFile: true });
    expect(r).toMatchObject({ ok: true, status: "pendente" });
    expect(r.ok && r.auto).toBeFalsy();
    expect(head(modDir())).toBe(old);
    expect(fresh).not.toBe(old);
    expect(listTrust().gm!.sha).toBe(old);
  });

  test("without always the update stays pending", async () => {
    const o = await trusted();
    o.commit({ "x.txt": "x" });
    const r = await updateModule("gm", { allowFile: true });
    expect(r).toMatchObject({ ok: true, status: "pendente" });
    expect(auditText()).not.toContain("automático");
  });

  test("diverged and dirty still fail with always", async () => {
    const o = await always();
    o.commit({ "x.txt": "x" });
    writeFileSync(join(modDir(), "junk"), "j");
    const dirty = await updateModule("gm", { allowFile: true });
    expect(dirty).toMatchObject({ ok: false });
    expect(!dirty.ok && dirty.error).toContain("árvore alterada");
    rmSync(join(modDir(), "junk"));
    writeFileSync(join(modDir(), "local.txt"), "l");
    sh(modDir(), "add", "-A");
    sh(modDir(), "commit", "-q", "-m", "local");
    const div = await updateModule("gm", { allowFile: true });
    expect(!div.ok && div.error).toContain("não é fast-forward");
  });

  test("an unreadable new manifest fails with always", async () => {
    const o = await always();
    o.commit({ "pvx-module.json": "{" });
    const r = await updateModule("gm", { allowFile: true });
    expect(!r.ok && r.error).toContain("manifest do commit novo ilegível");
  });

  test("CLI: --always on add and trust, list marker, update line", async () => {
    const o = origin();
    const sha = head(o.work);
    expect((await cli(`modules add ${o.url} --always`)).code).toBe(2);
    expect((await cli(`modules add ${o.url} --trust ${sha} --always`)).code).toBe(0);
    expect(listTrust().gm!.always).toBe(true);
    expect((await cli("modules list")).text).toMatch(/gm 1\.0\.0 \S+ .*∞ sempre/);
    await cli("modules trust --revoke gm");
    await cli(`modules trust gm --sha ${sha}`);
    expect(listTrust().gm!.always).toBeUndefined();
    expect((await cli(`modules trust gm --always`)).code).toBe(2);
    expect((await cli(`modules trust gm --sha ${sha} --always`)).code).toBe(0);
    expect(listTrust().gm!.always).toBe(true);
    const fresh = o.commit({ "x.txt": "x" }, "adiciona x");
    const r = await cli("modules update gm");
    expect(r.code).toBe(0);
    const lines = r.text.split("\n");
    expect(lines).toContain(`  ${fresh.slice(0, 7)} adiciona x`);
    expect(lines.at(-1)).toBe(`[✓] gm atualizado automaticamente em ${fresh.slice(0, 7)} (confiança sempre)`);
    expect(head(modDir())).toBe(fresh);
  });
});

describe("catalog modules are trusted always", () => {
  const auditText = () => {
    const f = join(process.env.PVX_HOME!, "audit.jsonl");
    return existsSync(f) ? readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).text).join(" | ") : "";
  };
  /** A fresh catalog cache, so the loader never touches the network. */
  const catalogOf = (...entries: { id: string; url: string }[]) =>
    writeFileSync(join(process.env.PVX_HOME!, "catalog.json"), JSON.stringify({ fetchedAt: Date.now(), modules: entries.map((e) => ({ ...e, descricao: "d" })) }));

  test("add with catalog: approved always and audited, no review needed", async () => {
    const o = origin();
    const r = await add(o.url, { catalog: true });
    expect(r).toMatchObject({ ok: true, status: "instalado", id: "gm", state: "carregado" });
    expect(listTrust().gm).toMatchObject({ sha: head(o.work), always: true });
    expect(auditText()).toContain(`trust automático (catálogo): gm ${head(o.work)} (${o.url})`);
    expect((await cli("gm hi", { registry: await load() })).text).toBe("[✓] oi de gm");
  });

  test("catalog add still refuses a wrong id and an incompatible system", async () => {
    const o = origin();
    expect((await add(o.url, { catalog: true, expectId: "outro" })).ok).toBe(false);
    expect(existsSync(modDir())).toBe(false);
    const w = origin("wm", { distro: ["rhel"] });
    const r = await add(w.url, { catalog: true, host: { os: "windows", distros: [], name: "Windows" } });
    expect(r).toMatchObject({ ok: false, incompatible: true });
    expect(listTrust().wm).toBeUndefined();
  });

  test("CLI: a catalog id installs without the approve hint", async () => {
    const o = origin();
    catalogOf({ id: "gm", url: o.url });
    const r = await cli("modules add gm");
    expect(r.code).toBe(0);
    expect(r.text).not.toContain("para aprovar");
    expect(r.text.split("\n").at(-1)).toBe("[✓] gm instalado do catálogo: confiança sempre");
    expect(listTrust().gm!.always).toBe(true);
    expect(await states()).toEqual({ gm: "carregado" });
  });

  test("CLI: a manual URL equal to a catalog entry is the same", async () => {
    const o = origin();
    catalogOf({ id: "gm", url: o.url });
    const r = await cli(`modules add ${o.url}`);
    expect(r.text.split("\n").at(-1)).toBe("[✓] gm instalado do catálogo: confiança sempre");
    expect(listTrust().gm!.always).toBe(true);
  });

  test("CLI: a URL outside the catalog keeps the normal review", async () => {
    const o = origin();
    catalogOf({ id: "other", url: "https://x.com/other.git" });
    const r = await cli(`modules add ${o.url}`);
    expect(r.text).toContain("pvx modules trust gm --sha");
    expect(r.text).not.toContain("do catálogo");
    expect(listTrust().gm).toBeUndefined();
  });

  test("catalog unavailable: the add is a normal awaiting-trust one, never an error", async () => {
    const o = origin();
    const r = await cli(`modules add ${o.url}`); // setup points PVX_CATALOG_URL at a refused port; no cache
    expect(r.code).toBe(0);
    expect(r.text).toContain("pvx modules trust gm --sha");
    expect(await states()).toEqual({ gm: "aguardando-confianca" });
  });

  test("update of a legacy (non-always) catalog module applies by itself and upgrades the record", async () => {
    const o = await trusted();
    catalogOf({ id: "gm", url: o.url });
    expect(listTrust().gm!.always).toBeUndefined();
    const fresh = o.commit({ "pvx-module.json": manifestOf("gm", { exec: ["curl"] }) }, "mais permissões");
    const r = await updateModule("gm", { allowFile: true });
    expect(r).toMatchObject({ ok: true, status: "atualizado", auto: true, sha: fresh });
    expect(head(modDir())).toBe(fresh);
    expect(listTrust().gm).toMatchObject({ sha: fresh, always: true });
    expect(auditText()).toContain(`trust automático (catálogo): gm ${fresh} (${o.url})`);
  });

  test("update of a module outside the catalog stays pending", async () => {
    const o = await trusted();
    catalogOf({ id: "other", url: "https://x.com/other.git" });
    o.commit({ "x.txt": "x" });
    expect(await updateModule("gm", { allowFile: true })).toMatchObject({ ok: true, status: "pendente" });
    expect(listTrust().gm!.always).toBeUndefined();
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

describe("review data", () => {
  const review = (id = "gm") => reviewModule(modDir(id));

  test("commit fields, with a 2-commit history", async () => {
    const o = origin();
    o.commit({ "a.ts": "export {};\n" }, "segundo commit");
    await add(o.url);
    const r = await review();
    expect(r.commit).toMatchObject({ sha: r.sha, short: r.sha.slice(0, 7), author: "t", subject: "segundo commit", count: 2 });
    expect(r.commit.date).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test("trustedBefore: unset when fresh, the approved sha after trust", async () => {
    const o = origin();
    const first = await add(o.url);
    expect(first.ok && first.review!.trustedBefore).toBeUndefined();
    const fresh = await review();
    expect("trustedBefore" in fresh).toBe(false);
    expect((await trustModule("gm", fresh.sha)).ok).toBe(true);
    expect((await review()).trustedBefore).toBe(fresh.sha);
  });

  test("files: lines, groups, sort and import graph (static, dynamic, re-export, require, tests not used)", async () => {
    const o = origin("gm", { entry: "src/index.ts" });
    for (const d of ["src/b", "test", "lib"]) mkdirSync(join(o.work, d), { recursive: true });
    o.commit({
      "src/index.ts": 'import { a } from "./a";\nimport "./side.js";\nexport * from "./re";\nconst d = () => import("./dyn.ts");\nimport fs from "node:fs";\nexport default () => a;\n',
      "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
      "src/b/index.ts": "export const b = 1;\n",
      "src/side.ts": "export {};\n",
      "src/re.ts": 'export const r = require("./b");\n',
      "src/dyn.ts": "export {};\n",
      "src/orphan.ts": "1;\n2;\n3;\n",
      "test/x.test.ts": 'import { a } from "../src/a.ts";\nBun.spawn(["x"]);\n',
      "lib/z.js": "module.exports = 1;",
      "root.ts": "export {};\n",
    });
    await add(o.url);
    const r = await review();
    const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(by["src/index.ts"]).toMatchObject({ entry: true, used: true, group: "src/", lines: 6 });
    for (const p of ["src/a.ts", "src/b/index.ts", "src/side.ts", "src/re.ts", "src/dyn.ts"]) expect(by[p]!.used).toBe(true);
    expect(by["src/orphan.ts"]).toMatchObject({ used: false, lines: 3 });
    expect(by["test/x.test.ts"]!.used).toBe(false);
    expect(by["src/a.ts"]!.importedBy).toEqual(["src/index.ts", "test/x.test.ts"]);
    expect(by["src/b/index.ts"]!.importedBy).toEqual(["src/a.ts", "src/re.ts"]);
    expect(by["root.ts"]!.group).toBe(".");
    expect(by["lib/z.js"]!.lines).toBe(1);
    expect(r.files.every((f) => !f.path.includes("\\"))).toBe(true);
    // entry group first, then alphabetical; lines desc inside a group
    expect(r.files.map((f) => f.group).filter((g, i, a) => a.indexOf(g) === i)).toEqual(["src/", ".", "lib/", "test/"]);
    const src = r.files.filter((f) => f.group === "src/").map((f) => f.path);
    expect(src[0]).toBe("src/index.ts");
    expect(src.indexOf("src/orphan.ts")).toBeLessThan(src.indexOf("src/b/index.ts"));
  });

  test("structured hits feed files[].hits, the unchanged warnings text and the CLI lines", async () => {
    const o = origin();
    o.commit({ "evil.ts": 'import { exec } from "node:child_process";\nBun.spawn(["x"]);\n' });
    await add(o.url);
    const r = await review();
    expect(r.files.find((f) => f.path === "evil.ts")!.hits).toEqual([{ line: 1, msg: "usa child_process" }, { line: 2, msg: "usa Bun.spawn" }]);
    expect(r.warnings.filter((w) => w.startsWith("evil.ts"))).toEqual(["evil.ts:1: usa child_process", "evil.ts:2: usa Bun.spawn"]);
    const lines = reviewLines(r, "x").map((l) => l.text);
    expect(lines).toContain("análise estática: evil.ts: linhas 1, 2 (usa child_process, usa Bun.spawn; fora do caminho do entry)");
    expect(lines[2]).toMatch(/^autor: t · \d\d\/\d\d\/\d{4} \d\d:\d\d · c$/);
  });

  test("permission summary: shells and escapes are broad, own state is not", () => {
    const home = process.env.PVX_HOME!;
    const s = summarizePermissions("gm", {
      exec: ["sh", "systemd-run", "ls", "/usr/bin/sudo"],
      fs: ["rw:/etc/systemd/system/", "rw:$PVX_HOME/modules/gm/state/", `rw:${home}/modules/gm/`, "/etc/hosts", "rw:$PVX_HOME/modules/other/", "rw:$PVX_HOME/modules/gm/../../etc/"],
      net: ["example.com:443"],
    });
    expect(s.broad).toEqual(["exec sh", "exec systemd-run", "exec /usr/bin/sudo", "rw /etc/systemd/system/", "rw $PVX_HOME/modules/other/", "rw $PVX_HOME/modules/gm/../../etc/"]);
    expect(s.commonCount).toBe(4);
    expect(s.net).toEqual(["example.com:443"]);
    expect(summarizePermissions("gm", {})).toEqual({ broad: [], commonCount: 0, net: [] });
  });

  test("command summary groups by first word and keeps order", () => {
    expect(summarizeCommands(["status", "ip list", "ip trust", "fw on", "reload", "ip del"])).toEqual({
      total: 6,
      groups: [{ name: "ip", count: 3 }, { name: "fw", count: 1 }],
      singles: ["status", "reload"],
    });
    expect(summarizeCommands(undefined)).toEqual({ total: 0, groups: [], singles: [] });
  });
});
