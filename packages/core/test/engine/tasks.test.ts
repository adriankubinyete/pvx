import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { PhasesState } from "@pvx/sdk";
import { createJobs, createRegistry, createStore, createLogger, FINISHED_WINDOW_MS, isResumable, jobsConfig, listTasks, logsDir, phasesKey, pvxHome, runCli, writeJobState, type Registry } from "../../src/index.ts";
import { loadModules } from "../../src/index.ts";

const FIX = join(import.meta.dir, "../fixtures");

/** A run that stopped in `dump`: `upload` never started. */
const phases = (runStartedAt: number, overrides: Partial<PhasesState> = {}): PhasesState => ({
  startedAt: runStartedAt,
  runStartedAt,
  phases: [
    { id: "dump", label: "dump", weight: 1, state: "done" },
    { id: "upload", label: "enviar", weight: 1, state: "pending" },
  ],
  ...overrides,
});

const NOW = 1_700_000_000_000;

describe("tasks", () => {
  beforeEach(() => mkdirSync(pvxHome(), { recursive: true }));

  test("every job of every module is a task, newest first, with the phases of its run", () => {
    writeJobState("alfa", "velho", { state: "done", startedAt: NOW - 5000, endedAt: NOW - 4000, line: "run a" });
    writeJobState("beta", "novo", { state: "failed", startedAt: NOW, endedAt: NOW + 10, line: "run b" });
    createStore("beta").set(phasesKey("novo"), phases(NOW));
    expect(listTasks().map((t) => `${t.module}/${t.name}`)).toEqual(["beta/novo", "alfa/velho"]);
    const task = listTasks()[0]!;
    expect(task.line).toBe("run b");
    expect(task.phases?.phases.map((p) => p.id)).toEqual(["dump", "upload"]);
    expect(listTasks()[1]!.phases).toBeUndefined();
  });

  test("a task is resumable when it failed or stopped before its last phase, and not otherwise", () => {
    const stopped = { state: "stopped" as const, startedAt: NOW };
    expect(isResumable({ state: "failed", startedAt: NOW }, phases(NOW), false)).toBe(true);
    expect(isResumable(stopped, phases(NOW), false)).toBe(true);
    expect(isResumable({ state: "running", startedAt: NOW }, phases(NOW), false)).toBe(false);
    expect(isResumable({ state: "done", startedAt: NOW }, phases(NOW), false)).toBe(false);
    expect(isResumable(stopped, undefined, false)).toBe(false); // no phases: nothing to continue from
    expect(isResumable(stopped, phases(NOW), true)).toBe(false); // its secrets are gone
    expect(isResumable(stopped, phases(NOW - 1000), false)).toBe(false); // the phases are of an older run
    const finished = phases(NOW);
    finished.phases.forEach((p) => (p.state = "done"));
    expect(isResumable(stopped, finished, false)).toBe(false);
  });

  test("a job given secrets is recorded as such, and a record that says running with no live process is failed", () => {
    writeJobState("alfa", "segredo", { state: "failed", startedAt: NOW, line: "run", withSecrets: true });
    createStore("alfa").set(phasesKey("segredo"), phases(NOW));
    expect(listTasks()[0]).toMatchObject({ name: "segredo", resumable: false });
    writeJobState("alfa", "morto", { state: "running", startedAt: Date.now() - 10 * 60_000, pid: 2 ** 22 + 7, line: "run" });
    expect(listTasks().find((t) => t.name === "morto")!.status.state).toBe("failed");
  });

  test("the finished window is 24 hours", () => {
    expect(FINISHED_WINDOW_MS).toBe(86_400_000);
  });
});

describe("who started and who stopped a job, and `jobs resume`", () => {
  let registry: Registry;
  const saved = { ...jobsConfig };
  beforeEach(async () => {
    mkdirSync(join(pvxHome(), "usermodules"), { recursive: true });
    symlinkSync(join(FIX, "jobmodules/jobber"), join(pvxHome(), "usermodules/jobber"));
    process.env.PVX_USERMODULES = join(pvxHome(), "usermodules");
    jobsConfig.selfCmd = () => [process.execPath, join(FIX, "job-main.ts")];
    jobsConfig.systemd = () => false;
    registry = createRegistry();
    await loadModules(registry, { hostVersion: "0.1.0", makeLogger: (n) => createLogger(logsDir(), n) });
  });
  afterEach(() => void Object.assign(jobsConfig, saved));
  const jobs = createJobs("jobber");
  const until = async (f: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await f()) return;
      await Bun.sleep(50);
    }
    throw new Error("timeout");
  };

  test("a start with no terminal is cron and one from a terminal is manual; a stop records who asked", async () => {
    jobsConfig.origin = () => "cron";
    await jobs.start("noite", "long");
    expect((await jobs.status("noite")).origin).toBe("cron");
    await until(async () => Boolean((await jobs.status("noite")).pid));
    jobsConfig.origin = () => "manual";
    await jobs.stop("noite");
    expect(await jobs.status("noite")).toMatchObject({ state: "stopped", origin: "cron", stoppedBy: "manual" });
    expect(listTasks().find((t) => t.name === "noite")!.status.stoppedBy).toBe("manual");
  }, 15_000);

  const resume = (name: string) => {
    const out: string[] = [];
    return runCli({
      argv: ["jobs", "resume", "jobber", name], env: process.env, isTTY: false, isRoot: true, registry, makeLogger: (n) => createLogger(logsDir(), n),
      profilesDir: "", version: "test", theme: { text: "", accent: "", ok: "", warn: "", error: "", info: "" }, out: (line) => void out.push(line),
    }).then((exit) => ({ exit, text: out.join("\n") }));
  };

  test("jobs resume starts the same line again when the task has a phase to continue, and refuses otherwise", async () => {
    const started = Date.now();
    writeJobState("jobber", "parado", { state: "stopped", startedAt: started, endedAt: started + 5, line: "quick" });
    createStore("jobber").set(phasesKey("parado"), phases(started));
    const ok = await resume("parado");
    expect(ok.exit).toBe(0);
    expect(ok.text).toContain("continuando");
    await until(async () => (await jobs.status("parado")).state === "done");

    const again = await resume("parado"); // finished now: no phase left to continue
    expect(again.exit).not.toBe(0);
    expect(again.text).toContain("não tem fase a continuar");
    expect((await resume("nunca")).text).toContain("job inexistente");
  });
});
