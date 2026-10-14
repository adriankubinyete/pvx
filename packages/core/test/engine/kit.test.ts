import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandCtx, Manifest, PhaseDef, StepError } from "@pvx/sdk";
import { createLogger, createPhases, createReadCtx, createRegistry, createStore, describeFailure, errorsKit, execute, logsDir, packagesKit, strategyKit } from "../../src/index.ts";

let dir = "";
beforeAll(() => void (dir = realpathSync(mkdtempSync(join(tmpdir(), "pvx-kit-")))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** One module `km` whose command runs `body` with the real ctx; returns the lines. */
async function run(body: (ctx: CommandCtx) => Promise<unknown>, permissions: Manifest["permissions"]) {
  const registry = createRegistry();
  registry.register({ id: "km", version: "1.0.0", entry: "x", permissions }, { commands: { go: { help: "h", run: async (ctx) => void (await body(ctx)) } } });
  return execute(registry, "km go", { makeLogger: (name) => createLogger(logsDir(), name) });
}

describe("ctx.shell", () => {
  const perms = { exec: ["sh", "true"] };

  test("run answers the result, ok a boolean, must throws a StepError with the cause and the output tail", async () => {
    let caught: StepError | undefined;
    const result = await run(async (ctx) => {
      expect((await ctx.shell.run("sh", ["-c", "echo oi"])).stdout).toBe("oi\n");
      expect(await ctx.shell.ok("sh", ["-c", "exit 3"])).toBe(false);
      expect(await ctx.shell.ok("true")).toBe(true);
      await ctx.shell.must("sh", ["-c", "echo 'error: sem espaço' >&2; exit 4"]).catch((error: StepError) => void (caught = error));
    }, perms);
    expect(result.ok).toBe(true);
    expect(caught).toMatchObject({ name: "StepError", code: 4, output: ["error: sem espaço"] });
    expect(caught?.message).toContain("saiu com código 4");
  });

  test("a program that cannot start is exit 127", async () => {
    await run(async (ctx) => {
      expect((await ctx.shell.run("sh", ["-c", "exit 0"], { cwd: "/nao/existe" })).code).toBe(127);
    }, perms);
  });

  test("the exec allowlist still holds: a program outside it throws, never becomes an exit code", async () => {
    const result = await run((ctx) => ctx.shell.run("ls"), perms);
    expect(result.lines[0]!.text).toContain("permissão negada");
  });
});

describe("ctx.fs.write options", () => {
  const modeOf = (file: string) => statSync(file).mode & 0o777;

  test("mode locks the file down, also over an existing wider one", async () => {
    const file = join(dir, "secret");
    await run(async (ctx) => {
      await ctx.fs.write(file, "a", { mode: 0o644 });
      await ctx.fs.write(file, "senha", { mode: 0o600 });
    }, { fs: [`rw:${dir}`] });
    expect(modeOf(file)).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("senha");
  });

  test("atomic leaves no temp file and keeps the mode", async () => {
    const file = join(dir, "atomic");
    await run((ctx) => ctx.fs.write(file, "inteiro", { mode: 0o600, atomic: true }), { fs: [`rw:${dir}`] });
    expect(readFileSync(file, "utf8")).toBe("inteiro");
    expect(modeOf(file)).toBe(0o600);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

test("store.update reads, changes and stores in one call", () => {
  const store = createStore("km-update");
  expect(store.update<number>("count", (current) => (current ?? 0) + 1)).toBe(1);
  expect(store.update<number>("count", (current) => (current ?? 0) + 1)).toBe(2);
  expect(store.get<number>("count")).toBe(2);
});

describe("phases", () => {
  const phaseList = (calls: string[], failAt?: string): PhaseDef[] =>
    ["repos", "packages", "database"].map((id) => ({
      id,
      label: id,
      run() {
        calls.push(id);
        if (id === failAt) throw new Error(`${id} quebrou`);
      },
    }));

  test("runs in order, persists, resumes from the failed phase and skips the finished ones", () => {
    const store = createStore("km-phases");
    const phases = createPhases(store);
    const calls: string[] = [];
    return phases.run("install", phaseList(calls, "packages")).then(async (first) => {
      expect(first).toMatchObject({ ok: false, failedPhase: "packages" });
      expect(phases.state("install")?.phases.map((phase) => phase.state)).toEqual(["done", "failed", "pending"]);
      expect(phases.state("install")?.failure).toMatchObject({ phase: "packages", message: "packages quebrou" });
      const second = await phases.run("install", phaseList(calls));
      expect(second).toEqual({ ok: true });
      expect(calls).toEqual(["repos", "packages", "packages", "database"]);
      expect(phases.state("install")?.failure).toBeUndefined();
    });
  });

  test("fresh starts over; a skipped outcome and report() are kept; a StepError records its command", async () => {
    const phases = createPhases(createStore("km-phases2"));
    const defs: PhaseDef[] = [
      { id: "a", label: "a", run: () => ({ skipped: "nada a fazer" }) },
      { id: "b", label: "b", run: (phase) => phase.report("3/4") },
      { id: "c", label: "c", run: () => Promise.reject(Object.assign(new Error("x"), { name: "StepError", command: "dnf install", code: 1, output: ["erro"] })) },
    ];
    await phases.run("n", defs);
    const state = phases.state("n")!;
    expect(state.phases.map((phase) => [phase.state, phase.detail])).toEqual([["skipped", "nada a fazer"], ["done", "3/4"], ["failed", undefined]]);
    expect(state.failure).toMatchObject({ command: "dnf install", code: 1, output: ["erro"] });
    const calls: string[] = [];
    await phases.run("n", phaseList(calls), { fresh: true });
    expect(calls).toEqual(["repos", "packages", "database"]);
  });
});

describe("package tracker", () => {
  const dnfLines = [
    "Dependencies resolved.",
    "Installing:",
    " httpd                x86_64   2.4.37-1.el8   appstream   1.4 M",
    "Transaction Summary",
    "Install  1 Package",
    "(1/1): httpd-2.4.37-1.el8.x86_64.rpm   1.2 MB/s | 1.4 MB   00:01",
    "Running transaction",
    "  Installing       : httpd-2.4.37-1.el8.x86_64    1/1",
    "  Running scriptlet: httpd-2.4.37-1.el8.x86_64    1/1",
    "  Verifying        : httpd-2.4.37-1.el8.x86_64    1/1",
  ];

  test("dnf: counts and the phase move from download to install to verify", () => {
    const tracker = packagesKit.tracker("dnf");
    const phases: (string | undefined)[] = [];
    for (const line of dnfLines) {
      tracker.feed(line);
      phases.push(tracker.phase);
    }
    expect(phases).toContain("download");
    expect(tracker.phase).toBe("verify");
    expect(tracker.progress).toMatchObject({ total: 1, running: [], failed: [] });
    expect(tracker.progress.done.map((pkg) => pkg.name)).toEqual(["httpd"]);
  });

  test("apt: total from the summary, current package per phase, done at Setting up", () => {
    const tracker = packagesKit.tracker("apt");
    tracker.feed("2 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.");
    tracker.feed("Get:1 http://deb.debian.org/debian bookworm/main amd64 curl amd64 7.88.1-10 [315 kB]");
    expect(tracker.progress.running).toMatchObject([{ name: "curl", version: "7.88.1-10", phase: "download" }]);
    tracker.feed("Unpacking curl (7.88.1-10) ...");
    expect(tracker.phase).toBe("install");
    expect(tracker.progress.running[0]).toMatchObject({ name: "curl", phase: "install" });
    tracker.feed("Setting up curl (7.88.1-10) ...");
    expect(tracker.progress).toMatchObject({ total: 3, running: [] });
    expect(tracker.progress.done.map((pkg) => pkg.name)).toEqual(["curl"]);
    tracker.feed("E: Unable to locate package nope");
    expect(tracker.progress.failed).toEqual(["nope"]);
  });
});

describe("strategy.pick", () => {
  const strategies = [
    { id: "firewalld", available: () => false },
    { id: "nftables", available: async () => true },
    { id: "iptables", available: () => true },
  ];

  test("auto takes the first available, in order", async () => {
    expect(await strategyKit.pick(strategies, { none: "nenhum" })).toMatchObject({ strategy: { id: "nftables" }, auto: true });
  });

  test("a chosen id wins without asking available; an unknown id and an empty list are errors", async () => {
    expect(await strategyKit.pick(strategies, { setting: "firewalld", none: "nenhum" })).toMatchObject({ strategy: { id: "firewalld" }, auto: false });
    expect(await strategyKit.pick(strategies, { setting: "pf", none: "nenhum" })).toEqual({ error: "desconhecido: pf (use auto, firewalld, nftables, iptables)" });
    expect(await strategyKit.pick([{ id: "x", available: () => false }], { none: "nenhum" })).toEqual({ error: "nenhum" });
  });
});

const noQuery = async () => undefined;

describe("strategy and shell on the contexts", () => {
  const strategies = [{ id: "nftables", available: () => true }];
  const perms = { exec: ["sh"] };

  test("ctx.strategy is the pick of sdk.strategy, in a command and in a probe", async () => {
    let picked: unknown;
    await run(async (ctx) => void (picked = await ctx.strategy.pick(strategies, { none: "nenhum" })), perms);
    expect(picked).toMatchObject({ strategy: { id: "nftables" }, auto: true });
    const read = createReadCtx("km", perms, (name) => createLogger(logsDir(), name), noQuery);
    expect(await read.strategy.pick(strategies, { none: "nenhum" })).toMatchObject({ auto: true });
  });

  test("a probe has shell.run and shell.ok over the allowlist, and no must", async () => {
    const read = createReadCtx("km", perms, (name) => createLogger(logsDir(), name), noQuery);
    expect((await read.shell.run("sh", ["-c", "echo oi; exit 2"])).code).toBe(2);
    expect(await read.shell.ok("sh", ["-c", "exit 0"])).toBe(true);
    expect("must" in read.shell).toBe(false);
    await expect(read.shell.run("ls")).rejects.toThrow("permissão negada");
  });
});

describe("StepError helpers", () => {
  const stepError = () => {
    const error = new Error("dnf install saiu com código 1") as StepError;
    return Object.assign(error, { name: "StepError" as const, command: "dnf install", code: 1, output: ["Error: no match", "Error: no space"] });
  };

  test("describeFailure gives the message plus the output tail, one indented line each; other errors give the message", () => {
    expect(describeFailure(stepError())).toBe("dnf install saiu com código 1\n  Error: no match\n  Error: no space");
    expect(describeFailure(new Error("falhou"))).toBe("falhou");
    expect(describeFailure("texto")).toBe("texto");
  });

  test("sdk.errors.isStepError recognises the shape and nothing else", () => {
    expect(errorsKit.isStepError(stepError())).toBe(true);
    expect(errorsKit.isStepError(new Error("x"))).toBe(false);
    expect(errorsKit.isStepError("StepError")).toBe(false);
  });

  test("a StepError that escapes a command shows its output tail, not just the message", async () => {
    const result = await run((ctx) => ctx.shell.must("sh", ["-c", "echo 'error: sem espaço' >&2; exit 4"]), { exec: ["sh"] });
    expect(result.lines[0]!.text).toContain("erro interno no comando: sh -c");
    expect(result.lines[0]!.text).toContain("\n  error: sem espaço");
  });
});
