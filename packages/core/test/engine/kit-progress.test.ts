import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandCtx, Manifest, PhaseDef, PhasesState } from "@pvx/sdk";
import { allPhasesFinished, createLogger, createPhases, createReadCtx, createRegistry, createStore, errorsKit, execute, logsDir, phasesKit, phasesProgress } from "../../src/index.ts";

let dir = "";
beforeAll(() => void (dir = realpathSync(mkdtempSync(join(tmpdir(), "pvx-kit-progress-")))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** One module `kp` whose command runs `body` with the real ctx; the options go to `execute`. */
async function run(body: (ctx: CommandCtx) => Promise<unknown>, permissions: Manifest["permissions"], extra: Partial<Parameters<typeof execute>[2]> = {}) {
  const registry = createRegistry();
  registry.register({ id: "kp", version: "1.0.0", entry: "x", permissions }, { commands: { go: { help: "h", run: async (ctx) => void (await body(ctx)) } } });
  return execute(registry, "kp go", { makeLogger: (name) => createLogger(logsDir(), name), ...extra });
}

describe("phase.progress", () => {
  const clock = { now: 1000 };
  const savedProgress = (store: ReturnType<typeof createStore>, name: string) => store.get<PhasesState>(`phases:${name}`)!.phases.map((record) => record.progress);

  test("the overall progress is the finished weights plus the running weight times its fraction", async () => {
    const store = createStore("kp-sum");
    let seen = 0;
    const defs: PhaseDef[] = [
      { id: "repos", label: "repos", weight: 1, run: () => {} },
      {
        id: "packages",
        label: "pacotes",
        weight: 8,
        run(phase) {
          phase.progress(0.5);
          seen = phasesProgress(store.get<PhasesState>("phases:sum")!);
        },
      },
      { id: "end", label: "fim", weight: 1, run: () => {} },
    ];
    await createPhases(store, undefined, () => clock.now).run("sum", defs);
    expect(seen).toBeCloseTo((1 + 4) / 10);
    const done = store.get<PhasesState>("phases:sum")!;
    expect(phasesProgress(done)).toBe(1);
    expect(done.phases.map((record) => record.progress)).toEqual([undefined, undefined, undefined]);
  });

  test("it writes the store only every 250 ms or when the fraction moved by 1%, and clamps to 0..1", async () => {
    const store = createStore("kp-throttle");
    const defs: PhaseDef[] = [
      {
        id: "packages",
        label: "pacotes",
        run(phase) {
          phase.progress(0.1);
          phase.progress(0.105); // too small and too soon: not written
          expect(savedProgress(store, "throttle")).toEqual([0.1]);
          phase.progress(0.2); // moved by 1%: written
          expect(savedProgress(store, "throttle")).toEqual([0.2]);
          clock.now += 300;
          phase.progress(0.2001); // 250 ms later: written
          expect(savedProgress(store, "throttle")).toEqual([0.2001]);
          phase.progress(7);
          expect(savedProgress(store, "throttle")).toEqual([1]);
        },
      },
    ];
    await createPhases(store, undefined, () => clock.now).run("throttle", defs);
  });

  test("a resume forgets the partial progress of the phase that was running", async () => {
    const store = createStore("kp-resume");
    const phases = createPhases(store, undefined, () => clock.now);
    const defs: PhaseDef[] = [
      {
        id: "packages",
        label: "pacotes",
        run(phase) {
          phase.progress(0.7);
          throw new Error("caiu");
        },
      },
    ];
    await phases.run("resume", defs);
    expect(savedProgress(store, "resume")).toEqual([0.7]);
    await phases.run("resume", [{ id: "packages", label: "pacotes", run: () => {} }]);
    expect(savedProgress(store, "resume")).toEqual([undefined]);
  });
});

describe("sdk.phases", () => {
  const state = (states: PhasesState["phases"][number]["state"][]): PhasesState => ({
    phases: states.map((phaseState, index) => ({ id: index === states.length - 1 ? "reboot" : `p${index}`, label: "x", weight: 1, state: phaseState })),
    startedAt: 1,
    runStartedAt: 1,
  });

  test("progress and finished are the host's, and finished ignores the trailing phases", () => {
    expect(phasesKit.progress(state(["done", "pending"]))).toBe(0.5);
    expect(phasesKit.finished(state(["done", "running"]))).toBe(false);
    expect(phasesKit.finished(state(["done", "running"]), ["reboot"])).toBe(true);
    expect(phasesKit.finished(state(["running", "running"]), ["reboot"])).toBe(false);
    expect(allPhasesFinished(state(["done", "pending"]), ["reboot"])).toBe(true);
  });
});

describe("sdk.errors.stepError", () => {
  test("builds a StepError that isStepError recognises and the phase runner records", async () => {
    const error = errorsKit.stepError("sem espaço em /var", "df /var", 1, ["0 bytes livres"]);
    expect(errorsKit.isStepError(error)).toBe(true);
    expect(error).toMatchObject({ name: "StepError", command: "df /var", code: 1, output: ["0 bytes livres"] });
    const store = createStore("kp-steperror");
    await createPhases(store).run("n", [{ id: "disk", label: "disco", run: () => {
      throw error;
    } }]);
    expect(store.get<PhasesState>("phases:n")?.failure).toMatchObject({ command: "df /var", code: 1, output: ["0 bytes livres"] });
  });
});

describe("ctx.isRoot and ctx.signal", () => {
  test("isRoot comes from the host that runs the command, also on the read context", async () => {
    const seen: boolean[] = [];
    await run(async (ctx) => void seen.push(ctx.isRoot), {}, { isRoot: false });
    await run(async (ctx) => void seen.push(ctx.isRoot), {}, { isRoot: true });
    expect(seen).toEqual([false, true]);
    const read = createReadCtx("kp", {}, (name) => createLogger(logsDir(), name), async () => undefined, undefined, false);
    expect(read.isRoot).toBe(false);
  });

  test("signal aborts when the host's does", async () => {
    const stop = new AbortController();
    let aborted: boolean[] = [];
    await run(async (ctx) => {
      aborted.push(ctx.signal.aborted);
      stop.abort();
      aborted.push(ctx.signal.aborted);
    }, {}, { signal: stop.signal });
    expect(aborted).toEqual([false, true]);
  });
});

describe("shell.echoing", () => {
  const perms = { exec: ["sh"] };

  test("writes `$ command` and each non-blank output line to the job log, and the calls still work", async () => {
    const jobLines: string[] = [];
    let code = -1;
    await run(async (ctx) => {
      const shell = ctx.shell.echoing();
      code = (await shell.run("sh", ["-c", "echo um; echo; echo dois >&2; exit 3"])).code;
    }, perms, { jobLog: (line) => void jobLines.push(line) });
    expect(code).toBe(3);
    expect(jobLines).toEqual(["$ sh -c echo um; echo; echo dois >&2; exit 3", "um", "dois"]);
  });

  test("a secret in the argv is never echoed when the call gives `display`; stdin is never echoed", async () => {
    const jobLines: string[] = [];
    await run(async (ctx) => {
      const shell = ctx.shell.echoing();
      await shell.must("sh", ["-c", "cat >/dev/null", "senha-secreta"], { stdin: "outra-senha", display: "sh -c cat <stdin>" });
    }, perms, { jobLog: (line) => void jobLines.push(line) });
    expect(jobLines).toEqual(["$ sh -c cat <stdin>"]);
    expect(jobLines.join("\n")).not.toContain("secreta");
    expect(jobLines.join("\n")).not.toContain("outra");
  });

  test("defaults apply (buffer false keeps stdout empty) and a call's own options win; the caller's onLine still runs", async () => {
    const seen: string[] = [];
    let buffered = "x";
    let override = "";
    await run(async (ctx) => {
      const shell = ctx.shell.echoing({ timeoutMs: 5000 });
      buffered = (await shell.run("sh", ["-c", "echo oi"], { onLine: (line) => void seen.push(line) })).stdout;
      override = (await shell.run("sh", ["-c", "echo oi"], { buffer: true })).stdout;
    }, perms);
    expect(buffered).toBe("");
    expect(seen).toEqual(["oi"]);
    expect(override).toBe("oi\n");
  });

  test("the program runs in its own process group (the signal is ctx.signal), so aborting the job stops it", async () => {
    const stop = new AbortController();
    let code = 0;
    setTimeout(() => stop.abort(), 100);
    const started = Date.now();
    await run(async (ctx) => {
      code = (await ctx.shell.echoing().run("sh", ["-c", "sleep 20"])).code;
    }, perms, { signal: stop.signal });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(code).not.toBe(0);
  });

  test("outside a job nothing is written and the call is plain", async () => {
    let ok = false;
    await run(async (ctx) => void (ok = await ctx.shell.echoing().ok("sh", ["-c", "exit 0"])), perms);
    expect(ok).toBe(true);
  });
});
