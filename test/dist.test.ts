import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, runCli } from "../packages/core/src/index.ts";
import { theme } from "../packages/tui/src/index.ts";

const root = join(import.meta.dir, "..");
const asset = `pvx-${process.platform}-${process.arch === "x64" ? "amd64" : process.arch}.tar.gz`;
const tmp = () => mkdtempSync(join(tmpdir(), "pvx-dist-test-"));

/** A fake GitHub: tarball with a one-line "binary", checksums, and the releases/latest API. */
let server: ReturnType<typeof Bun.serve>;
let mode: { sum?: string; status?: number; tag: string } = { tag: "v0.2.0" };
let tarball: Uint8Array;
let goodSum: string;
const NEW = "#!/bin/sh\necho pvx-new\n";

beforeAll(() => {
  const d = tmp();
  writeFileSync(join(d, "pvx"), NEW);
  chmodSync(join(d, "pvx"), 0o755);
  Bun.spawnSync(["tar", "-czf", join(d, asset), "-C", d, "pvx"]);
  tarball = new Uint8Array(readFileSync(join(d, asset)));
  goodSum = new Bun.CryptoHasher("sha256").update(tarball).digest("hex");
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (mode.status) return new Response("no", { status: mode.status });
      if (pathname.endsWith("/releases/latest")) {
        const u = `http://localhost:${server.port}/dl`;
        return Response.json({ tag_name: mode.tag, assets: [{ name: asset, browser_download_url: `${u}/${asset}` }, { name: "checksums-sha256.txt", browser_download_url: `${u}/checksums-sha256.txt` }] });
      }
      if (pathname.endsWith(asset)) return new Response(tarball);
      if (pathname.endsWith("checksums-sha256.txt")) return new Response(`${mode.sum ?? goodSum}  ${asset}\n`);
      return new Response("nope", { status: 404 });
    },
  });
});
afterAll(() => server.stop(true));

async function install(extra: Record<string, string> = {}) {
  const d = tmp();
  const paths = { PVX_LIB_DIR: join(d, "lib/pvx"), PVX_BIN_DIR: join(d, "local-bin"), PVX_USRBIN_DIR: join(d, "usr-bin") };
  const p = Bun.spawn(["sh", join(root, "install.sh")], {
    env: { PATH: process.env.PATH!, TMPDIR: d, PVX_RELEASE_BASE: `http://localhost:${server.port}/releases`, ...paths, ...extra },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { d, paths, out, err, exit };
}

test("install.sh: clean install puts the binary, the /usr/local/bin link and the /usr/bin link in place", async () => {
  mode = { tag: "v0.2.0" };
  const r = await install();
  expect(r.err).toBe("");
  expect(r.exit).toBe(0);
  expect(readFileSync(join(r.paths.PVX_LIB_DIR, "pvx"), "utf8")).toBe(NEW);
  for (const dir of [r.paths.PVX_BIN_DIR, r.paths.PVX_USRBIN_DIR]) expect(lstatSync(join(dir, "pvx")).isSymbolicLink()).toBe(true);
  expect(Bun.spawnSync([join(r.paths.PVX_USRBIN_DIR, "pvx")]).stdout.toString()).toBe("pvx-new\n");
});

test("install.sh: a bad checksum or a failed download leaves nothing behind", async () => {
  mode = { tag: "v0.2.0", sum: "0".repeat(64) };
  const bad = await install();
  expect(bad.exit).not.toBe(0);
  expect(bad.err).toContain("checksum");
  mode = { tag: "v0.2.0", status: 404 };
  const down = await install();
  expect(down.exit).not.toBe(0);
  for (const r of [bad, down]) for (const p of Object.values(r.paths)) expect(existsSync(p)).toBe(false);
});

test("install.sh: refuses to run as non-root against the real system paths", async () => {
  const p = Bun.spawnSync(["sh", join(root, "install.sh")], { env: { PATH: process.env.PATH!, PVX_RELEASE_BASE: "http://localhost:1" } });
  if (process.getuid?.() !== 0) expect(p.stderr.toString()).toContain("root");
});

async function selfUpdate(version: string, installed: string, argv = ["self-update"], io: { ask?: (q: string) => Promise<string>; isTTY?: boolean } = {}) {
  const bin = join(tmp(), "pvx");
  writeFileSync(bin, installed);
  chmodSync(bin, 0o755);
  const out: string[] = [];
  const exit = await runCli({
    argv,
    env: { NO_COLOR: "1", PVX_SELF_PATH: bin, PVX_API_BASE: `http://localhost:${server.port}` },
    isTTY: io.isTTY ?? false,
    isRoot: true,
    registry: createRegistry(),
    makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    profilesDir: "",
    version,
    theme,
    out: (l) => out.push(l),
    ask: io.ask,
  });
  return { bin, exit, out: out.join("\n") };
}

test("self-update: already on the latest version does nothing and exits 0", async () => {
  mode = { tag: "v0.2.0" };
  const r = await selfUpdate("0.2.0", "OLD");
  expect(r.exit).toBe(0);
  expect(r.out).toContain("já está na versão mais recente");
  expect(readFileSync(r.bin, "utf8")).toBe("OLD");
});

test("self-update: swaps the binary in place, executable, with no leftovers, and warns about running processes", async () => {
  mode = { tag: "v0.2.0" };
  const r = await selfUpdate("0.1.0", "OLD");
  expect(r.exit).toBe(0);
  expect(readFileSync(r.bin, "utf8")).toBe(NEW);
  expect(lstatSync(r.bin).mode & 0o111).not.toBe(0);
  expect(readdirSync(join(r.bin, "..")).filter((n) => n.startsWith(".pvx-update"))).toEqual([]);
  expect(r.out).toContain("continuam na versão antiga");
});

// Acceptance (spec): a wrong hash never touches the installed binary.
test("self-update: a hash mismatch aborts and leaves the installed file byte-identical", async () => {
  mode = { tag: "v0.2.0", sum: "f".repeat(64) };
  const r = await selfUpdate("0.1.0", "OLD");
  expect(r.exit).toBe(1);
  expect(r.out).toContain("checksum");
  expect(readFileSync(r.bin, "utf8")).toBe("OLD");
  expect(readdirSync(join(r.bin, "..")).filter((n) => n.startsWith(".pvx-update"))).toEqual([]);
});

test("self-update: a development build asks first (--yes outside a TTY), and a refusal changes nothing", async () => {
  mode = { tag: "v0.2.0" };
  const dev = "0.1.0 (nightly, abc1234)";
  const noTty = await selfUpdate(dev, "OLD");
  expect(noTty.exit).toBe(2);
  expect(readFileSync(noTty.bin, "utf8")).toBe("OLD");
  const asked: string[] = [];
  const no = await selfUpdate(dev, "OLD", ["self-update"], { isTTY: true, ask: async (q) => (asked.push(q), "n") });
  expect(asked.length).toBe(1);
  expect(no.exit).toBe(1);
  expect(readFileSync(no.bin, "utf8")).toBe("OLD");
  expect(readFileSync((await selfUpdate(dev, "OLD", ["self-update", "--yes"])).bin, "utf8")).toBe(NEW);
});

async function uninstall(args: string[], io: { ask?: (q: string) => Promise<string>; isTTY?: boolean } = {}) {
  const d = tmp();
  const dirs = { PVX_LIB_DIR: join(d, "lib/pvx"), PVX_BIN_DIR: join(d, "bin"), PVX_USRBIN_DIR: join(d, "usrbin") };
  mkdirSync(dirs.PVX_LIB_DIR, { recursive: true });
  writeFileSync(join(dirs.PVX_LIB_DIR, "pvx"), "x");
  for (const b of [dirs.PVX_BIN_DIR, dirs.PVX_USRBIN_DIR]) {
    mkdirSync(b);
    symlinkSync(join(dirs.PVX_LIB_DIR, "pvx"), join(b, "pvx"));
  }
  const profiled = join(d, "profile.d");
  mkdirSync(profiled);
  writeFileSync(join(profiled, "pvx-banner.sh"), "x");
  const home = process.env.PVX_HOME!;
  mkdirSync(join(home, "usermodules/m"), { recursive: true });
  mkdirSync(join(home, "logs"));
  writeFileSync(join(home, "notes.jsonl"), "{}\n");
  writeFileSync(join(home, "trust.json"), "{}");
  const prev = process.env.PVX_PROFILED_DIR;
  process.env.PVX_PROFILED_DIR = profiled;
  const exit = await runCli({
    argv: ["uninstall", ...args],
    env: { NO_COLOR: "1", ...dirs },
    isTTY: io.isTTY ?? false,
    isRoot: true,
    registry: createRegistry(),
    makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    profilesDir: "",
    version: "0.1.0",
    theme,
    out: () => {},
    ask: io.ask,
  }).finally(() => (prev === undefined ? delete process.env.PVX_PROFILED_DIR : (process.env.PVX_PROFILED_DIR = prev)));
  const system = [dirs.PVX_LIB_DIR, join(dirs.PVX_BIN_DIR, "pvx"), join(dirs.PVX_USRBIN_DIR, "pvx"), join(profiled, "pvx-banner.sh")];
  const gone = (p: string) => !existsSync(p) && (() => { try { return !lstatSync(p); } catch { return true; } })();
  return { exit, home, systemGone: system.every(gone) };
}

test("uninstall: removes the library, both links and the login hook, and leaves PVX_HOME alone", async () => {
  const r = await uninstall([]);
  expect(r.exit).toBe(0);
  expect(r.systemGone).toBe(true);
  expect(existsSync(join(r.home, "notes.jsonl"))).toBe(true);
});

// Acceptance (spec): --purge never deletes notes or user modules without an explicit yes.
test("uninstall --purge: keeps notes.jsonl and usermodules/ unless explicitly confirmed", async () => {
  const kept = await uninstall(["--purge", "--yes"]);
  expect(kept.systemGone).toBe(true);
  expect(existsSync(join(kept.home, "notes.jsonl"))).toBe(true);
  expect(existsSync(join(kept.home, "usermodules/m"))).toBe(true);
  expect(existsSync(join(kept.home, "trust.json"))).toBe(false);
  expect(existsSync(join(kept.home, "logs"))).toBe(false);

  const declined = await uninstall(["--purge"], { isTTY: true, ask: async () => "n" });
  expect(existsSync(join(declined.home, "notes.jsonl"))).toBe(true);

  const flag = await uninstall(["--purge", "--purge-notes-and-modules"]);
  expect(existsSync(flag.home)).toBe(false);
  const asked = await uninstall(["--purge"], { isTTY: true, ask: async () => "s" });
  expect(existsSync(asked.home)).toBe(false);
});
