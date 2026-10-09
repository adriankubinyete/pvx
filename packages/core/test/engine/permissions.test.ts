import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandCtx, Manifest } from "@pvx/sdk";
import { createLogger, createRegistry, execute, logsDir, moduleStateDir } from "../../src/index.ts";

let root = "";
let ro = "";
let rw = "";
const servers: ReturnType<typeof Bun.serve>[] = [];
const serve = () => (servers.push(Bun.serve({ port: 0, fetch: () => new Response("pong") })), servers.at(-1)!);
const allowed = serve();
const other = serve();

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pvx-perm-")));
  ro = join(root, "ro");
  rw = join(root, "rw");
  mkdirSync(ro);
  mkdirSync(rw);
  writeFileSync(join(ro, "a.txt"), "lido");
  writeFileSync(join(root, "secret.txt"), "segredo");
  symlinkSync(join(root, "secret.txt"), join(ro, "esc.txt"));
});
afterAll(() => {
  servers.forEach((s) => s.stop(true));
  rmSync(root, { recursive: true, force: true });
});

/** One module `pm` whose single command runs `body` with the real ctx; returns the lines. */
async function run(body: (c: CommandCtx) => Promise<unknown>, permissions: Manifest["permissions"]) {
  const registry = createRegistry();
  registry.register({ id: "pm", version: "1.0.0", entry: "x", permissions }, { commands: { go: { help: "h", run: async (c) => void (await body(c)) } } });
  return execute(registry, "pm go", { makeLogger: (n) => createLogger(logsDir(), n) });
}
const logOf = (n: string) => readFileSync(join(logsDir(), `${n}.log`), "utf8");

describe("ctx.exec", () => {
  test("a listed command runs (no shell, args verbatim)", async () => {
    let out = "";
    const r = await run(async (c) => (out = (await c.exec("echo", ["a;b", "$HOME"])).stdout), { exec: ["echo"] });
    expect(r.ok).toBe(true);
    expect(out).toBe("a;b $HOME\n");
  });

  test("the basename decides: an absolute path to a listed name runs", async () => {
    let code = -1;
    await run(async (c) => (code = (await c.exec(Bun.which("echo")!, ["x"])).code), { exec: ["echo"] });
    expect(code).toBe(0);
  });

  test("a command that is not listed throws and is logged to the module log and core.log", async () => {
    const r = await run((c) => c.exec("ls"), { exec: ["echo"] });
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.text).toContain("permissão negada");
    expect(logOf("pm")).toContain('permissão negada para o módulo "pm": exec ls');
    expect(logOf("core")).toContain('permissão negada para o módulo "pm": exec ls');
  });

  test("no permissions at all denies everything", async () => {
    expect((await run((c) => c.exec("echo"), undefined)).ok).toBe(false);
  });

  test("the timeout kills the process", async () => {
    let code = 0;
    await run(async (c) => (code = (await c.exec("sleep", ["5"], { timeoutMs: 100 })).code), { exec: ["sleep"] });
    expect(code).not.toBe(0);
  });
});

describe("ctx.net", () => {
  const host = (s: { port?: number }) => `localhost:${s.port}`;
  test("a listed host:port is fetched", async () => {
    let body = "";
    await run(async (c) => (body = await (await c.net.fetch(`http://${host(allowed)}/`)).text()), { net: [host(allowed)] });
    expect(body).toBe("pong");
  });

  test("another host or port throws and is logged", async () => {
    const r = await run((c) => c.net.fetch(`http://${host(other)}/`), { net: [host(allowed)] });
    expect(r.ok).toBe(false);
    expect(r.lines[0]!.text).toContain(`net ${host(other)}`);
    expect(logOf("core")).toContain(`net ${host(other)}`);
  });

  test("a redirect to an unlisted host is not followed", async () => {
    const redir = Bun.serve({ port: 0, fetch: () => Response.redirect(`http://${host(other)}/`, 302) });
    servers.push(redir);
    let status = 0;
    await run(async (c) => (status = (await c.net.fetch(`http://${host(redir)}/`)).status), { net: [host(redir)] });
    expect(status).not.toBe(200);
  });

  test("a non-http scheme is refused", async () => {
    expect((await run((c) => c.net.fetch("file:///etc/passwd"), { net: [""] })).ok).toBe(false);
  });
});

describe("ctx.fs", () => {
  const perms = () => ({ fs: [ro, `rw:${rw}`] });
  test("read-only prefix: read, exists and list work, write is refused", async () => {
    let seen: unknown[] = [];
    const r = await run(async (c) => (seen = [await c.fs.read(join(ro, "a.txt")), await c.fs.exists(join(ro, "a.txt")), await c.fs.exists(join(ro, "no")), await c.fs.list(ro)]), perms());
    expect(r.ok).toBe(true);
    expect(seen).toEqual(["lido", true, false, ["a.txt", "esc.txt"]]);
    const w = await run((c) => c.fs.write(join(ro, "b.txt"), "x"), perms());
    expect(w.ok).toBe(false);
    expect(w.lines[0]!.text).toContain("fs escrita");
  });

  test("rw: prefix allows write", async () => {
    let back = "";
    await run(async (c) => (await c.fs.write(join(rw, "sub/c.txt"), "grava"), (back = await c.fs.read(join(rw, "sub/c.txt")))), perms());
    expect(back).toBe("grava");
  });

  test("outside every prefix, `..` and a symlink out of the prefix are refused; the log says so", async () => {
    for (const p of [join(root, "secret.txt"), join(ro, "..", "secret.txt"), join(ro, "esc.txt")]) {
      const r = await run((c) => c.fs.read(p), perms());
      expect(r.ok).toBe(false);
    }
    expect(logOf("pm")).toContain("fs leitura");
    expect(logOf("core")).toContain("fs leitura");
  });

  test("the module's own state dir is always allowed, read and write, with no manifest permission", async () => {
    let back = "";
    const f = join(moduleStateDir("pm"), "mine.txt");
    const r = await run(async (c) => (await c.fs.write(f, "meu"), (back = await c.fs.read(f))), undefined);
    expect(r.ok).toBe(true);
    expect(back).toBe("meu");
  });

  test("another module's state dir is not", async () => {
    expect((await run((c) => c.fs.read(join(moduleStateDir("outro"), "state.json")), undefined)).ok).toBe(false);
  });
});
