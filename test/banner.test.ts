import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, createRegistry, execute, loadModules, logsDir, pvxHome, runCli, type Registry } from "../packages/core/src/index.ts";
import { builtin } from "../packages/builtin/index.ts";
import { theme } from "../packages/tui/src/index.ts";

const root = join(import.meta.dir, "..");
const makeLogger = (n: string) => createLogger(logsDir(), n);
const ESC = /\x1b/;

async function registryWith(...extra: Parameters<Registry["register"]>[]): Promise<Registry> {
  const r = createRegistry();
  await loadModules(r, { hostVersion: "0.1.0", makeLogger, builtin });
  for (const e of extra) r.register(...e);
  return r;
}

/** Last conformity result on disk (what `conformidade` leaves) and one pinned note by another user. */
function seed(o: { agoMs?: number; notes?: boolean; results?: object[] } = {}) {
  const results = o.results ?? [
    { id: "t.ok", level: "ok", text: "Firewall: ativo" },
    { id: "t.ssl", level: "error", text: "SSL: certificado expirado", fix: "pvx ssl renew" },
    { id: "t.bkp", level: "warn", text: "Backup: sem rotina", fix: "pvx autobackup setup" },
  ];
  writeFileSync(join(pvxHome(), "conformity-snapshot.json"), JSON.stringify({ at: Date.now() - (o.agoMs ?? 2 * 3600_000), profile: "Central Phonevox", results }));
  if (o.notes === false) return;
  const ev = [
    { v: 1, id: "a1", at: "2026-10-09T10:00:00Z", ev: "add", author: "ana", text: "não reiniciar o asterisk antes das 18h" },
    { v: 1, id: "a1", at: "2026-10-09T10:01:00Z", ev: "pin", author: "ana" },
    { v: 1, id: "b2", at: "2026-10-09T11:00:00Z", ev: "add", author: "ana", text: "nota solta, não fixada" },
  ];
  writeFileSync(join(pvxHome(), "notes.jsonl"), ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

async function banner(registry: Registry, env: Record<string, string> = {}, o: { isTTY?: boolean; isRoot?: boolean } = {}) {
  const out: string[] = [];
  const exit = await runCli({
    argv: ["banner"], env: { LOGNAME: "rafael", ...env }, isTTY: o.isTTY ?? false, isRoot: o.isRoot ?? false, registry, makeLogger,
    profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme, out: (l) => void out.push(l),
  });
  return { exit, out, text: out.join("\n") };
}

test("sections, in under 1 s with the network unavailable and no evaluation", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => (fetched++, Promise.reject(new Error("sem rede")))) as unknown as typeof fetch;
  try {
    let proved = 0;
    const r = await registryWith([{ id: "t", version: "1", entry: "x" }, { capabilities: [{ id: "t.ssl", title: "SSL", goal: "g", prove: () => (proved++, { level: "ok", text: "ok" }) }] }]);
    mkdirSync(join(pvxHome(), "profiles"));
    writeFileSync(join(pvxHome(), "profiles", "10.json"), JSON.stringify({ id: "p", title: "P", requires: ["t.ssl"] }));
    seed();
    const t0 = performance.now();
    const b = await banner(r, { COLUMNS: "100" });
    const ms = performance.now() - t0;
    expect(b.exit).toBe(0);
    expect(ms).toBeLessThan(1000);
    expect(b.text).toContain("perfil Central Phonevox");
    expect(b.text).toContain("pvx 0.1.0");
    expect(b.text).toContain("checklist 1/3 · verificado há 2 h");
    expect(b.text).toContain("[✗] SSL: certificado expirado\n    → pvx ssl renew");
    expect(b.text).toContain("[!] Backup: sem rotina");
    expect(b.text).toContain("notas · 2 novas para você"); // both open notes are by someone else and newer than the (missing) marker
    expect(b.text).toContain("▸ ana: não reiniciar o asterisk antes das 18h");
    expect(b.text).not.toContain("nota solta"); // not pinned
    expect(b.out[0]).toMatch(/^═+$/);
    expect(b.out.at(-1)).toBe("digite pvx para abrir · PVX_QUIET=1 silencia");
    expect(proved).toBe(0); // it never evaluates
    expect(fetched).toBe(0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("at most 5 pending items and 3 notes; an ignored item is not pending", async () => {
  const results = Array.from({ length: 8 }, (_, i) => ({ id: `t.c${i}`, level: "error", text: `Item ${i}: falhou`, fix: `pvx fix ${i}` }));
  seed({ results, notes: false });
  writeFileSync(join(pvxHome(), "ignores.json"), JSON.stringify([{ id: "t.c0", until: new Date(Date.now() + 3600_000).toISOString(), reason: "r", author: "ana" }]));
  const ev = Array.from({ length: 5 }, (_, i) => [{ v: 1, id: `n${i}`, at: `2026-10-09T10:0${i}:00Z`, ev: "add", author: "ana", text: `nota ${i}` }, { v: 1, id: `n${i}`, at: `2026-10-09T10:1${i}:00Z`, ev: "pin", author: "ana" }]).flat();
  writeFileSync(join(pvxHome(), "notes.jsonl"), ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const b = await banner(await registryWith());
  expect(b.text).toContain("checklist 0/7");
  expect(b.out.filter((l) => l.startsWith("[✗]"))).toHaveLength(5);
  expect(b.text).not.toContain("Item 0");
  expect(b.text).toContain("+2 pendência(s)");
  expect(b.out.filter((l) => l.includes("▸"))).toHaveLength(3);
});

test("a missing source is skipped silently: no snapshot, no notes module", async () => {
  const b = await banner(await registryWith());
  expect(b.exit).toBe(0);
  expect(b.text).not.toContain("checklist");
  expect(b.text).not.toContain("notas");
  const bare = createRegistry(); // no module at all: the roles are absent
  seed();
  expect((await banner(bare)).text).not.toContain("notas");
});

test("NO_COLOR gives no escapes; a TTY without it colors; no TTY is plain", async () => {
  seed();
  const r = await registryWith();
  expect((await banner(r, { NO_COLOR: "1" }, { isTTY: true })).text).not.toMatch(ESC);
  expect((await banner(r, {}, { isTTY: false })).text).not.toMatch(ESC);
  const colored = (await banner(r, {}, { isTTY: true })).text;
  expect(colored).toMatch(ESC);
  expect(colored).toContain("═"); // the glyphs stay without color too
  expect((await banner(r, { NO_COLOR: "1" })).text).toContain("═");
});

test("COLUMNS=60 truncates every line", async () => {
  seed({ results: [{ id: "t.x", level: "error", text: `SSL: ${"muito longo ".repeat(12)}`, fix: `pvx ${"comprido ".repeat(12)}` }] });
  const b = await banner(await registryWith(), { COLUMNS: "60" });
  expect(Math.max(...b.out.map((l) => [...l].length))).toBeLessThanOrEqual(60);
  expect(b.text).toContain("…");
  const wide = await banner(await registryWith(), { COLUMNS: "200" });
  expect(Math.max(...wide.out.map((l) => [...l].length))).toBeGreaterThan(60);
});

test("records a login entry (user and SSH_CLIENT origin); a non-root login does not error", async () => {
  seed();
  const r = await registryWith();
  expect((await banner(r, { SSH_CLIENT: "203.0.113.9 51000 22" }, { isRoot: false })).exit).toBe(0);
  const rec = JSON.parse(readFileSync(join(pvxHome(), "audit.jsonl"), "utf8").trim().split("\n").at(-1)!);
  expect(rec).toMatchObject({ v: 1, kind: "login", user: "rafael", from: "203.0.113.9" });
  // an unwritable home: the banner still prints and exits 0
  process.env.PVX_HOME = join(pvxHome(), "notes.jsonl", "nope");
  const b = await banner(r);
  expect(b.exit).toBe(0);
  expect(b.out.length).toBeGreaterThan(0);
});

test("the real entrypoint prints it in well under 1 s (built-ins only, no network)", async () => {
  seed();
  const t0 = performance.now();
  const p = Bun.spawn(["bun", join(root, "apps/pvx/src/index.ts"), "banner"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, PVX_HOME: pvxHome(), LOGNAME: "rafael", NO_COLOR: "1" } });
  const [text, exit] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  const ms = performance.now() - t0;
  console.log(`banner via bun run: ${ms.toFixed(0)} ms`);
  expect(exit).toBe(0);
  expect(ms).toBeLessThan(1000);
  expect(text).toContain("checklist 1/3");
  expect(text).toContain("▸ ana:");
});

// ---- the motd module: the login hook ----

async function installHook() {
  const dir = mkdtempSync(join(tmpdir(), "pvx-profiled-"));
  process.env.PVX_PROFILED_DIR = dir;
  const r = await registryWith();
  const run = (cmd: string) => execute(r, cmd, { makeLogger });
  return { dir, file: join(dir, "pvx-banner.sh"), run };
}

test("motd install-hook writes the script under the profile.d dir and remove-hook removes it", async () => {
  const { file, run } = await installHook();
  expect((await run("motd install-hook")).ok).toBe(true);
  expect(existsSync(file)).toBe(true);
  const sh = readFileSync(file, "utf8");
  expect(sh).toContain("[ -t 1 ]");
  expect(sh).toContain("PVX_QUIET");
  expect(sh).toContain("timeout 1 pvx banner");
  expect(sh).toContain("|| true");
  expect((await run("motd install-hook")).ok).toBe(true); // idempotent
  expect((await run("motd remove-hook")).ok).toBe(true);
  expect(existsSync(file)).toBe(false);
  const again = await run("motd remove-hook");
  expect(again.ok).toBe(true);
  expect(again.lines[0]!.text).toContain("não estava instalado");
  delete process.env.PVX_PROFILED_DIR;
});

/** Runs the installed script with sh on a pty (so `[ -t 1 ]` holds) and a PATH holding only the given tools. */
async function runScript(script: string, bin: string, env: Record<string, string> = {}, tty = true) {
  let out = "";
  const t0 = performance.now();
  const opts = { cwd: bin, env: { PATH: bin, ...env }, ...(tty ? { terminal: { cols: 80, rows: 24, data: (_: unknown, d: Uint8Array) => void (out += new TextDecoder().decode(d)) } } : { stdout: "pipe" as const, stderr: "pipe" as const }) };
  const p = Bun.spawn(["/bin/sh", script], opts as never);
  const exit = await p.exited;
  if (!tty) out = await new Response(p.stdout as ReadableStream).text();
  await Bun.sleep(30);
  return { out, exit, ms: performance.now() - t0 };
}

async function sandbox(withTimeout: boolean, fake: string) {
  const { file, run } = await installHook();
  await run("motd install-hook");
  const bin = mkdtempSync(join(tmpdir(), "pvx-bin-"));
  const tool = (n: string, body: string) => (writeFileSync(join(bin, n), `#!/bin/sh\n${body}\n`), chmodSync(join(bin, n), 0o755));
  tool("pvx", fake);
  for (const n of withTimeout ? ["sleep", "timeout"] : ["sleep"]) {
    const real = Bun.which(n);
    if (real) symlinkSync(real, join(bin, n));
  }
  return { script: file, bin };
}

for (const withTimeout of [false, true]) {
  const label = withTimeout ? "with timeout(1)" : "without timeout(1) (background-kill fallback)";
  const skip = withTimeout && !Bun.which("timeout");

  test.skipIf(skip)(`hook script ${label}: prints on a terminal, silent with PVX_QUIET=1 or without a TTY`, async () => {
    const { script, bin } = await sandbox(withTimeout, "echo BANNER-OUT");
    const ok = await runScript(script, bin);
    expect(ok.exit).toBe(0);
    expect(ok.out).toContain("BANNER-OUT");
    const quiet = await runScript(script, bin, { PVX_QUIET: "1" });
    expect(quiet.exit).toBe(0);
    expect(quiet.out).not.toContain("BANNER-OUT");
    const piped = await runScript(script, bin, {}, false);
    expect(piped.exit).toBe(0);
    expect(piped.out).not.toContain("BANNER-OUT");
  });

  test.skipIf(skip)(`hook script ${label}: a hung or failing pvx never blocks or fails the login`, async () => {
    const hung = await sandbox(withTimeout, "echo START; sleep 10");
    const h = await runScript(hung.script, hung.bin);
    expect(h.exit).toBe(0);
    expect(h.ms).toBeLessThan(3000);
    const bad = await sandbox(withTimeout, "exit 7");
    const b = await runScript(bad.script, bad.bin);
    expect(b.exit).toBe(0);
  });
}
