import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, runCli, trustModule } from "../packages/core/src/index.ts";
import { useFixtureModules } from "../packages/testing/src/index.ts";
import { theme } from "../packages/tui/src/index.ts";

const root = join(import.meta.dir, "..");

/** Fixtures reach the real entrypoint as recorded dev links: the trust gate is never bypassed. */
async function pvx(args: string[], env: Record<string, string> = {}, fixtures = ["demo"]) {
  const { NO_COLOR: _drop, ...base } = process.env;
  const home = useFixtureModules(fixtures);
  const p = Bun.spawn(["bun", join(root, "apps/pvx/src/index.ts"), ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...base, ...home, ...env },
  });
  const [stdout, stderr, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, exit };
}

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));

test("no args and no TTY: prints the help and exits 2 (never hangs, never opens the TUI)", async () => {
  const r = await pvx([]);
  expect(r.exit).toBe(2);
  expect(r.stdout).toContain("uso: pvx");
  expect(r.stdout).toContain("demo greet");
});

test("PVX_USERMODULES does not bypass trust: an untrusted git module is never imported, and loads once approved", async () => {
  const um = join(process.env.PVX_HOME!, "um");
  const mod = join(um, "gm");
  const marker = join(process.env.PVX_HOME!, "marker");
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "pvx-module.json"), JSON.stringify({ id: "gm", version: "1.0.0", entry: "index.ts" }));
  writeFileSync(join(mod, "index.ts"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "x");\nexport default () => ({ commands: { hi: { help: "h", run: (c: any) => c.out.success("oi") } } });\n`);
  for (const a of [["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "i"]]) Bun.spawnSync(["git", "-C", mod, ...a]);
  const env = { PVX_USERMODULES: um };
  const r = await pvx(["modules"], env, []);
  expect(r.stdout).toContain("gm 1.0.0 aguardando-confianca");
  expect(existsSync(marker)).toBe(false);
  // control: the same module, approved for this commit, does import
  process.env.PVX_USERMODULES = um;
  expect((await trustModule("gm", Bun.spawnSync(["git", "-C", mod, "rev-parse", "HEAD"]).stdout.toString().trim())).ok).toBe(true);
  await pvx(["modules"], env, []);
  expect(existsSync(marker)).toBe(true);
});

process.env.PVX_USERMODULES = join(root, "packages/core/test/fixtures/usermodules");
const registry = createRegistry();
await loadModules(registry, { hostVersion: "1.0.0", makeLogger: (n) => createLogger(logsDir(), n) });

/** In-process runner with injected root, real file logs and captured stdout. */
async function run(argv: string[], env: Record<string, string> = {}) {
  const out: string[] = [];
  const exit = await runCli({
    argv,
    env: { NO_COLOR: "1", ...env },
    isTTY: false,
    isRoot: true,
    registry,
    makeLogger: (n) => createLogger(logsDir(), n),
    profilesDir: join(root, "profiles"),
    version: "1.0.0",
    theme,
    out: (l) => out.push(l),
  });
  return { stdout: out.map((l) => `${l}\n`).join(""), exit };
}

test("non-root user running a module command gets the sudo message and exit 1", async () => {
  const r = await pvx(["demo", "greet", "bob"]);
  expect(r.exit).toBe(1);
  expect(r.stdout).toContain("rode com sudo");
});

test("NO_COLOR: no escape sequences, glyphs stay", async () => {
  const r = await run(["demo", "greet", "bob"]);
  expect(r.stdout).toBe("[✓] oi bob\n");
  expect(r.stdout).not.toContain("\x1b");
});

test("--json prints exactly one object", async () => {
  const r = await run(["demo", "greet", "bob", "--json"]);
  expect(JSON.parse(r.stdout)).toEqual({ ok: true, exit: 0, lines: [{ kind: "success", text: "oi bob" }] });
});

test("PVX_SECRET_* reaches the command but appears in neither stdout nor any file under PVX_HOME", async () => {
  const secret = "hunter2-s3cr3t-value";
  const r = await run(["demo", "login"], { PVX_SECRET_TOKEN: secret });
  expect(r.exit).toBe(0);
  expect(r.stdout).toBe("[✓] token com 20 chars\n"); // the command did receive it
  expect(r.stdout).not.toContain(secret);
  const all = files(process.env.PVX_HOME!);
  expect(all.some((f) => f.endsWith("demo.log"))).toBe(true); // the run was logged...
  for (const f of all) expect(readFileSync(f, "utf8")).not.toContain(secret); // ...without the secret
});

test("a throwing command becomes an error line and its traceback goes to the module log", async () => {
  const r = await run(["throws-on-run", "crash"]);
  expect(r.exit).toBe(1);
  expect(r.stdout).toContain("kaboom");
  expect(readFileSync(join(process.env.PVX_HOME!, "logs/throws-on-run.log"), "utf8")).toContain("kaboom");
});

test("`help` and `h` print the --help listing; `help demo` details the module; no root needed", async () => {
  const base = { NO_COLOR: "1" };
  const root = await run(["--help"], base);
  for (const a of [["help"], ["h"]]) {
    const r = await run(a, { ...base });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe(root.stdout);
  }
  const m = await run(["help", "demo"], base);
  expect(m.stdout).toContain("Comandos:");
  expect(m.stdout).toContain("demo greet");
  expect((await run(["help", "demo", "greet"], base)).stdout).toContain("uso: pvx demo greet");
  expect((await run(["help", "nope"], base)).exit).toBe(3);
  expect(JSON.parse((await run(["help", "--json"], base)).stdout).lines.length).toBeGreaterThan(5);
});

test("the real entrypoint starts with no args and no TTY: help and exit 2, no internal error", async () => {
  const r = await pvx([]);
  expect(r.stdout).not.toContain("erro interno");
  expect(r.exit).toBe(2);
});
