// The newer `ctx.fs` operations and the binary/streamed `ctx.net`: each one stays behind `permissions.fs` and `permissions.net`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeSync, existsSync, ftruncateSync, linkSync, openSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandCtx, Manifest } from "@pvx/sdk";
import { createLogger, createReadCtx, createRegistry, execute, logsDir } from "../../src/index.ts";

let root = "";
let ro = "";
let rw = "";
const servers: ReturnType<typeof Bun.serve>[] = [];
const KIB = 1024;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pvx-fsnet-")));
  ro = join(root, "ro");
  rw = join(root, "rw");
  mkdirSync(ro);
  mkdirSync(rw);
});
afterAll(() => {
  servers.forEach((server) => server.stop(true));
  rmSync(root, { recursive: true, force: true });
});

const makeLogger = (name: string) => createLogger(logsDir(), name);
const logOf = (name: string) => readFileSync(join(logsDir(), `${name}.log`), "utf8");

/** One module `fn` whose single command runs `body` with the real ctx. */
async function run(body: (ctx: CommandCtx) => Promise<unknown>, permissions: Manifest["permissions"]) {
  const registry = createRegistry();
  registry.register({ id: "fn", version: "1.0.0", entry: "x", permissions }, { commands: { go: { help: "h", run: async (ctx) => void (await body(ctx)) } } });
  return execute(registry, "fn go", { makeLogger });
}

/** The result of `body`, or the message of what it threw: a refusal is the point of most of these. */
async function outcome<T>(body: (ctx: CommandCtx) => Promise<T>, permissions: Manifest["permissions"]): Promise<{ value?: T; error?: string }> {
  let value: T | undefined;
  const result = await run(async (ctx) => (value = await body(ctx)), permissions);
  return result.ok ? { value } : { error: result.lines.map((line) => line.text).join("\n") };
}

const perms = () => ({ fs: [ro, `rw:${rw}`] });

describe("ctx.fs.mkdir", () => {
  test("creates the folder with the mode asked, whatever the umask says, and leaves one that exists alone", async () => {
    const dir = join(rw, "made", "deep");
    const { error } = await outcome((ctx) => ctx.fs.mkdir(dir, { mode: 0o775 }), perms());
    expect(error).toBeUndefined();
    expect(lstatSync(dir).mode & 0o7777).toBe(0o775);
    await outcome((ctx) => ctx.fs.mkdir(dir, { mode: 0o700 }), perms());
    expect(lstatSync(dir).mode & 0o7777).toBe(0o775);
  });

  test("needs rw: a read-only prefix and a path outside every prefix are refused", async () => {
    for (const path of [join(ro, "new"), join(root, "new")]) {
      expect((await outcome((ctx) => ctx.fs.mkdir(path), perms())).error).toContain("permissão negada");
      expect(existsSync(path)).toBe(false);
    }
  });
});

describe("ctx.fs.stat and entries", () => {
  beforeAll(() => {
    writeFileSync(join(ro, "file.txt"), "12345");
    mkdirSync(join(ro, "folder"), { recursive: true });
    symlinkSync(join(ro, "file.txt"), join(ro, "link"));
  });

  test("stat answers size, kind, permission bits and mtime, and undefined for a path that is not there", async () => {
    const { value } = await outcome(async (ctx) => [await ctx.fs.stat(join(ro, "file.txt")), await ctx.fs.stat(join(ro, "folder")), await ctx.fs.stat(join(ro, "missing"))], perms());
    const [file, folder, missing] = value!;
    expect(file).toMatchObject({ size: 5, isDir: false });
    expect(file!.mode).toBe(lstatSync(join(ro, "file.txt")).mode & 0o7777);
    expect(file!.mtimeMs).toBeGreaterThan(0);
    expect(folder).toMatchObject({ isDir: true });
    expect(missing).toBeUndefined();
  });

  test("entries tells files, folders and symlinks apart, sorted by name", async () => {
    const { value } = await outcome((ctx) => ctx.fs.entries(ro), perms());
    expect(value).toEqual(expect.arrayContaining([{ name: "file.txt", type: "file" }, { name: "folder", type: "dir" }, { name: "link", type: "symlink" }]));
    expect(value!.map((entry) => entry.name)).toEqual([...value!.map((entry) => entry.name)].sort());
  });

  test("stat and entries respect the read rule", async () => {
    expect((await outcome((ctx) => ctx.fs.stat(join(root, "elsewhere")), perms())).error).toContain("fs leitura");
    expect((await outcome((ctx) => ctx.fs.entries(root), perms())).error).toContain("fs leitura");
  });
});

describe("ctx.fs.du and free", () => {
  test("du sums a folder recursively and counts a hard link once", async () => {
    const lone = join(rw, "du-lone");
    const linked = join(rw, "du-linked");
    for (const dir of [lone, linked]) mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(lone, "sub", "data"), Buffer.alloc(256 * KIB, 1));
    writeFileSync(join(linked, "sub", "data"), Buffer.alloc(256 * KIB, 1));
    linkSync(join(linked, "sub", "data"), join(linked, "copy"));
    const { value } = await outcome(async (ctx) => [await ctx.fs.du(lone), await ctx.fs.du(linked), await ctx.fs.du(join(rw, "du-missing"))], perms());
    const [loneBytes, linkedBytes, missingBytes] = value!;
    expect(loneBytes).toBeGreaterThanOrEqual(256 * KIB);
    expect(Math.abs(linkedBytes! - loneBytes!)).toBeLessThan(64 * KIB);
    expect(missingBytes).toBe(0);
  });

  test("free answers the space of the filesystem, also for a folder that is not created yet", async () => {
    const { value } = await outcome((ctx) => ctx.fs.free(join(rw, "not", "yet", "created")), perms());
    expect(value!.availableBytes).toBeGreaterThan(0);
    expect(value!.totalBytes).toBeGreaterThanOrEqual(value!.availableBytes);
  });

  test("du and free respect the read rule", async () => {
    expect((await outcome((ctx) => ctx.fs.du(root), perms())).error).toContain("fs leitura");
    expect((await outcome((ctx) => ctx.fs.free(root), perms())).error).toContain("fs leitura");
  });
});

describe("ctx.fs.remove recursive", () => {
  test("deletes a folder and everything in it; without recursive a folder is refused and kept", async () => {
    const dir = join(rw, "tree");
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "a", "b", "f"), "x");
    expect((await outcome((ctx) => ctx.fs.remove(dir), perms())).error).toBeDefined();
    expect(existsSync(dir)).toBe(true);
    expect((await outcome((ctx) => ctx.fs.remove(dir, { recursive: true }), perms())).error).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
    expect((await outcome((ctx) => ctx.fs.remove(dir, { recursive: true }), perms())).error).toBeUndefined(); // gone already: no error
  });

  test("refuses a path outside the rw: prefixes and anything under a read-only one", async () => {
    const outside = join(root, "keep");
    mkdirSync(outside);
    for (const path of [outside, join(ro, "folder")]) {
      expect((await outcome((ctx) => ctx.fs.remove(path, { recursive: true }), perms())).error).toContain("fs escrita");
    }
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(join(ro, "folder"))).toBe(true);
  });

  test("refuses the filesystem root even when a manifest allows rw:/", async () => {
    const { error } = await outcome((ctx) => ctx.fs.remove("/", { recursive: true }), { fs: ["rw:/"] });
    expect(error).toContain("raiz do sistema de arquivos");
  });

  test("removing a symlink removes the link and never what it points to", async () => {
    const target = join(ro, "file.txt");
    const link = join(rw, "link-to-ro");
    symlinkSync(target, link);
    expect((await outcome((ctx) => ctx.fs.remove(link), perms())).error).toBeUndefined();
    expect(existsSync(target)).toBe(true);
    expect(() => lstatSync(link)).toThrow();
  });
});

describe("read-only context", () => {
  test("has the new reads and none of the writers", async () => {
    const readCtx = createReadCtx("fn", { fs: [ro] }, makeLogger, async () => undefined);
    expect(Object.keys(readCtx.fs).sort()).toEqual(["du", "entries", "exists", "free", "list", "read", "stat"]);
    expect(await readCtx.fs.entries(ro)).toBeInstanceOf(Array);
  });
});

// ---- ctx.net ----

const SECRET = "Bearer s3cr3t-t0ken-must-never-be-logged";

interface Seen {
  headers: Headers;
  bytes: Uint8Array;
  form?: Awaited<ReturnType<Request["formData"]>>;
}

/** A server that keeps what it got: the raw bytes, and the parsed form when the request was multipart. */
function recorder(): { host: string; seen: () => Seen } {
  let last: Seen | undefined;
  const server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1024 ** 3,
    async fetch(request) {
      const bytes = new Uint8Array(await request.clone().arrayBuffer());
      const isForm = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
      last = { headers: request.headers, bytes, form: isForm ? await request.formData() : undefined };
      return new Response("received");
    },
  });
  servers.push(server);
  return { host: `localhost:${server.port}`, seen: () => last! };
}

const randomBytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length))).fill(0xff, 0, 8); // not valid UTF-8, on purpose

describe("ctx.net body", () => {
  test("a Uint8Array goes out byte for byte", async () => {
    const server = recorder();
    const bytes = randomBytes(10_000);
    const { error } = await outcome((ctx) => ctx.net.fetch(`http://${server.host}/`, { method: "PUT", body: bytes, headers: { authorization: SECRET } }), { net: [server.host] });
    expect(error).toBeUndefined();
    expect(server.seen().bytes).toEqual(bytes);
    expect(server.seen().headers.get("authorization")).toBe(SECRET);
  });

  test("a bodyFile is streamed from disk with its length, and needs read access to the path", async () => {
    const server = recorder();
    const bytes = randomBytes(3 * 1024 * KIB);
    const file = join(ro, "payload.bin");
    writeFileSync(file, bytes);
    const { error } = await outcome((ctx) => ctx.net.fetch(`http://${server.host}/`, { method: "PUT", bodyFile: file }), { net: [server.host], fs: [ro] });
    expect(error).toBeUndefined();
    expect(server.seen().bytes).toEqual(bytes);
    expect(server.seen().headers.get("content-length")).toBe(String(bytes.length));
    const denied = await outcome((ctx) => ctx.net.fetch(`http://${server.host}/`, { method: "PUT", bodyFile: file }), { net: [server.host] });
    expect(denied.error).toContain("fs leitura");
  });

  test("body and bodyFile together are refused", async () => {
    const server = recorder();
    const { error } = await outcome((ctx) => ctx.net.fetch(`http://${server.host}/`, { body: "x", bodyFile: join(ro, "payload.bin") }), { net: [server.host], fs: [ro] });
    expect(error).toContain("body ou bodyFile");
  });
});

describe("ctx.net.upload", () => {
  const file = () => join(ro, "archive.tar");

  test("sends the file as multipart, streamed: text fields first, then the file, with its length known", async () => {
    const server = recorder();
    const bytes = randomBytes(5 * 1024 * KIB + 123);
    writeFileSync(file(), bytes);
    const { error } = await outcome(
      (ctx) => ctx.net.upload(`http://${server.host}/v1/upload`, { file: file(), field: "file", fields: { path: "/clients/x", note: 'quote " and\r\nbreak' }, headers: { authorization: SECRET, "content-type": "text/plain", "content-length": "1" } }),
      { net: [server.host], fs: [ro] },
    );
    expect(error).toBeUndefined();
    const { form, headers, bytes: raw } = server.seen();
    expect(headers.get("authorization")).toBe(SECRET);
    expect(headers.get("content-type")).toStartWith("multipart/form-data; boundary=");
    expect(headers.get("content-length")).toBe(String(raw.length)); // the upload's own length replaced the one given
    expect(form!.get("path")).toBe("/clients/x");
    expect(form!.get("note")).toBe('quote " and\r\nbreak');
    const part = form!.get("file") as File;
    expect(part.name).toBe("archive.tar");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes);
    const text = new TextDecoder("latin1").decode(raw);
    expect(text.indexOf('name="path"')).toBeLessThan(text.indexOf('name="file"'));
  });

  test("a file much bigger than the memory it costs is sent whole (streamed, not loaded)", async () => {
    const FILE_BYTES = 600 * 1024 * KIB; // sparse: it takes no disk
    const MEMORY_BUDGET = 200 * 1024 * KIB;
    let received = 0;
    const counter = Bun.serve({
      port: 0,
      maxRequestBodySize: 2 * FILE_BYTES,
      async fetch(request) {
        for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) received += chunk.length;
        return new Response("ok");
      },
    });
    servers.push(counter);
    const big = join(ro, "big.sparse");
    const fd = openSync(big, "w");
    ftruncateSync(fd, FILE_BYTES);
    closeSync(fd);
    const before = process.memoryUsage().rss;
    const host = `localhost:${counter.port}`;
    const { error } = await outcome((ctx) => ctx.net.upload(`http://${host}/`, { file: big, timeoutMs: 120_000 }), { net: [host], fs: [ro] });
    expect(error).toBeUndefined();
    expect(received).toBeGreaterThan(FILE_BYTES);
    expect(process.memoryUsage().rss - before).toBeLessThan(MEMORY_BUDGET);
    rmSync(big);
  });

  test("filename and field are the caller's, and a quote or a line break in them cannot end the header (it is percent-encoded)", async () => {
    const server = recorder();
    writeFileSync(file(), "x");
    await outcome((ctx) => ctx.net.upload(`http://${server.host}/`, { file: file(), field: 'arq"uivo', filename: 'a"b\r\nc.tar' }), { net: [server.host], fs: [ro] });
    const names = [...server.seen().form!.keys()];
    expect(names).toEqual(["arq%22uivo"]);
    expect((server.seen().form!.get("arq%22uivo") as File).name).toBe("a%22b%0D%0Ac.tar");
  });

  test("a file outside permissions.fs, a host outside permissions.net and something that is not a file are refused", async () => {
    const server = recorder();
    writeFileSync(file(), "x");
    expect((await outcome((ctx) => ctx.net.upload(`http://${server.host}/`, { file: file() }), { net: [server.host] })).error).toContain("fs leitura");
    expect((await outcome((ctx) => ctx.net.upload(`http://${server.host}/`, { file: file() }), { net: ["other:1"], fs: [ro] })).error).toContain(`net ${server.host}`);
    expect((await outcome((ctx) => ctx.net.upload(`http://${server.host}/`, { file: join(ro, "folder") }), { net: [server.host], fs: [ro] })).error).toContain("não é um arquivo");
  });
});

describe("ctx.net limits and secrecy", () => {
  const silent = () => {
    const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    servers.push(server);
    return `localhost:${server.port}`;
  };

  test("timeoutMs cancels a request that never answers, with a message that says why", async () => {
    const host = silent();
    const { error } = await outcome((ctx) => ctx.net.fetch(`http://${host}/`, { timeoutMs: 150 }), { net: [host] });
    expect(error).toContain("sem resposta em 150 ms");
  });

  test("a signal cancels the request", async () => {
    const host = silent();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const { error } = await outcome((ctx) => ctx.net.fetch(`http://${host}/`, { signal: controller.signal }), { net: [host] });
    expect(error).toContain("pedido cancelado");
  });

  test("a signal that is aborted already cancels at once, also for an upload", async () => {
    const host = silent();
    writeFileSync(join(ro, "small.bin"), "x");
    const controller = new AbortController();
    controller.abort();
    const { error } = await outcome((ctx) => ctx.net.upload(`http://${host}/`, { file: join(ro, "small.bin"), signal: controller.signal }), { net: [host], fs: [ro] });
    expect(error).toContain("pedido cancelado");
  });

  test("a redirect is still not followed, for fetch and for upload", async () => {
    const target = recorder();
    const redirect = Bun.serve({ port: 0, fetch: () => Response.redirect(`http://${target.host}/`, 307) });
    servers.push(redirect);
    const host = `localhost:${redirect.port}`;
    writeFileSync(join(ro, "small.bin"), "x");
    const { value } = await outcome(async (ctx) => [(await ctx.net.fetch(`http://${host}/`, { method: "POST", body: "x" })).status, (await ctx.net.upload(`http://${host}/`, { file: join(ro, "small.bin") })).status], { net: [host], fs: [ro] });
    expect(value).toEqual([307, 307]);
  });

  test("a header such as Authorization never reaches the module log or core.log, not on a refusal and not on a failure", async () => {
    const refused = await outcome((ctx) => ctx.net.fetch("http://unlisted.example:1/", { headers: { authorization: SECRET } }), { net: ["listed.example:1"] });
    expect(refused.error).toContain("permissão negada");
    const unreachable = await outcome((ctx) => ctx.net.fetch("http://localhost:1/", { headers: { authorization: SECRET }, timeoutMs: 2000 }), { net: ["localhost:1"] });
    expect(unreachable.error).toBeDefined();
    writeFileSync(join(ro, "small.bin"), "x");
    const upload = await outcome((ctx) => ctx.net.upload("http://localhost:1/", { file: join(ro, "small.bin"), headers: { authorization: SECRET }, timeoutMs: 2000 }), { net: ["localhost:1"], fs: [ro] });
    expect(upload.error).toBeDefined();
    for (const text of [refused.error!, unreachable.error!, upload.error!, logOf("fn"), logOf("core")]) expect(text).not.toContain("s3cr3t");
  });
});
