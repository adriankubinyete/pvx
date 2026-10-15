import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { readLogs, createGranted, createJobs, jobsConfig, jobsDir, pvxHome, type Registry } from "../../src/index.ts";
import { createLogger, createRegistry, execute, logsDir, runCli } from "../../src/index.ts";

const FIX = join(import.meta.dir, "../fixtures");
const log = { debug() {}, info() {}, warn() {}, error() {} };
const g = createGranted("m", { exec: ["sh", "sleep"] }, log, log);

describe("ctx.exec streaming", () => {
  test("onLine gets lines, splitting on \\r and \\r\\n, and the result is still buffered", async () => {
    const got: string[] = [];
    const r = await g.exec("sh", ["-c", "printf 'a\\nb\\r 10%%\\r 50%%\\r\\nend'; printf 'err\\n' >&2"], { onLine: (l, s) => void got.push(`${s}:${l}`) });
    expect(got.filter((x) => x.startsWith("stdout"))).toEqual(["stdout:a", "stdout:b", "stdout: 10%", "stdout: 50%", "stdout:end"]);
    expect(got).toContain("stderr:err");
    expect(r.stdout).toContain("end");
    expect(r.code).toBe(0);
  });
  test("buffer: false leaves the result empty but still streams", async () => {
    const got: string[] = [];
    const r = await g.exec("sh", ["-c", "echo x"], { buffer: false, onLine: (l) => void got.push(l) });
    expect(got).toEqual(["x"]);
    expect(r.stdout).toBe("");
  });
  test("an abort kills a sleep (SIGTERM) well before its end", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    const r = await g.exec("sleep", ["30"], { signal: ac.signal, timeoutMs: 60_000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.code).not.toBe(0);
  });
  test("an abort kills the children of a shell too (process group), escalating to SIGKILL", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    await g.exec("sh", ["-c", "trap '' TERM; sleep 30 & wait"], { signal: ac.signal, timeoutMs: 60_000 });
    expect(Date.now() - t0).toBeLessThan(4500);
  });
  test("an already aborted signal does not run to the end", async () => {
    const t0 = Date.now();
    await g.exec("sleep", ["30"], { signal: AbortSignal.abort(), timeoutMs: 60_000 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("jobs", () => {
  let registry: Registry;
  const saved = { ...jobsConfig };
  beforeEach(() => {
    mkdirSync(join(pvxHome(), "usermodules"), { recursive: true });
    symlinkSync(join(FIX, "jobmodules/jobber"), join(pvxHome(), "usermodules/jobber"));
    process.env.PVX_USERMODULES = join(pvxHome(), "usermodules");
    jobsConfig.selfCmd = () => [process.execPath, join(FIX, "job-main.ts")];
    jobsConfig.systemd = () => false; // no systemd-run: the detached fallback
    registry = createRegistry();
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
  const ended = (n: string) => until(async () => (await jobs.status(n)).state !== "running");

  test("quick job lifecycle and secrets", async () => {
    await jobs.start("q2", "quick", { secrets: { token: "s3cr3t-value" } });
    const sec = join(jobsDir("jobber"), "q2.secrets");
    expect((await jobs.status("q2")).state).toBe("running");
    await ended("q2");
    const st = await jobs.status("q2");
    expect(st).toMatchObject({ state: "done", exit: 0 });
    expect(st.endedAt).toBeGreaterThanOrEqual(st.startedAt!);
    const lines = await jobs.log("q2");
    expect(lines.slice(0, 3)).toEqual(["i starting", "raw=***", "✓ len=12"]); // reached the job (length 12), masked in the log
    expect(await jobs.log("q2", { tail: 1 })).toHaveLength(1);
    expect(await jobs.log("q2", { since: 2 })).toHaveLength(lines.length - 2);
    expect(existsSync(sec)).toBe(false); // deleted at start
    const files = readdirSync(jobsDir("jobber")).map((f) => readFileSync(join(jobsDir("jobber"), f), "utf8")).join("\n");
    expect(files).not.toContain("s3cr3t-value");
    expect(lines.join("\n")).not.toContain("s3cr3t-value");
    expect(lines.find((l) => l.startsWith("argv="))).not.toContain("s3cr3t");
    expect(readFileSync(join(pvxHome(), "audit.jsonl"), "utf8")).toContain("start jobber/q2");
    expect((await jobs.list()).map((j) => j.name)).toContain("q2");
  });

  test("job lines reach the module log (readLogs), progress lines are deduped, lifecycle is logged", async () => {
    await jobs.start("lg", "quick", { secrets: { token: "s3cr3t-value" } });
    await ended("lg");
    const mod = readLogs({ logsDir: logsDir(), modules: ["jobber"], tail: 100 }).join("\n");
    expect(mod).toContain("job lg iniciado");
    expect(mod).toContain("[job lg] i starting");
    expect(mod).toContain("[job lg] raw=***");
    expect(mod).toContain("[job lg] terminou (exit 0)");
    expect(mod).not.toContain("s3cr3t-value");
    expect(readLogs({ logsDir: logsDir(), modules: ["core"], tail: 100 }).join("\n")).toContain("job jobber: job lg iniciado");
  });

  test("progress lines that differ only by digits are logged once in the module log, fully in the job file", async () => {
    await jobs.start("pg", "progress");
    await ended("pg");
    expect(await jobs.log("pg")).toEqual(["a 10%", "a 55%", "a 100%", "fim"]);
    const mod = readLogs({ logsDir: logsDir(), modules: ["jobber"], tail: 100 }).filter((l) => l.includes("[job pg] a "));
    expect(mod).toHaveLength(1);
  });

  test("the secrets file is 0600 while it waits", async () => {
    jobsConfig.selfCmd = () => ["sleep", "1"]; // never reads it
    await jobs.start("w", "quick", { secrets: { token: "zzz-zzz" } });
    const mode = Bun.spawnSync(["stat", process.platform === "darwin" ? "-f" : "-c", process.platform === "darwin" ? "%Lp" : "%a", join(jobsDir("jobber"), "w.secrets")]).stdout.toString().trim();
    expect(mode).toBe("600");
  });

  test("a second start while running fails; stop kills the long job; ps shows no secret", async () => {
    await jobs.start("l", "long", { secrets: { token: "hunter2-hunter2" } });
    await until(async () => Boolean((await jobs.status("l")).pid));
    await expect(jobs.start("l", "long")).rejects.toThrow("já está rodando");
    const pid = (await jobs.status("l")).pid!;
    expect(Bun.spawnSync(["ps", "-o", "args=", "-p", String(pid)]).stdout.toString()).not.toContain("hunter2");
    await until(async () => (await jobs.log("l")).includes("i blocking"));
    await jobs.stop("l");
    expect((await jobs.status("l")).state).toBe("stopped");
    expect(Bun.spawnSync(["pgrep", "-f", "sleep 60"]).stdout.toString().trim()).toBe(""); // the sleep went with it
    expect(readFileSync(join(pvxHome(), "audit.jsonl"), "utf8")).toContain("stop jobber/l");
    await expect(jobs.stop("l")).rejects.toThrow("não está rodando");
  }, 15_000);

  test("a failing command makes the job failed; bad names are refused", async () => {
    await jobs.start("b", "bad");
    await ended("b");
    expect(await jobs.status("b")).toMatchObject({ state: "failed", exit: 1 });
    expect(await jobs.log("b")).toEqual(["✗ boom"]);
    await expect(jobs.start("../x", "bad")).rejects.toThrow("inválido");
    expect(await jobs.status("nope")).toEqual({ state: "none" });
  });

  test("ctx.jobs is on the command ctx and read-only on ReadCtx", async () => {
    registry.register({ id: "jobber", version: "1.0.0", entry: "x" }, { commands: { peek: { help: "h", async run(c) { c.out.info(`state=${(await c.jobs.status("zz")).state}`); c.jobLog("ignored"); } } } });
    const r = await execute(registry, "jobber peek", { makeLogger: (n) => createLogger(logsDir(), n) });
    expect(r.lines[0]!.text).toBe("state=none");
    expect(Object.keys(registry.readCtx("jobber").jobs).sort()).toEqual(["list", "log", "status"]);
  });

  test("pvx jobs list, log and stop (core commands)", async () => {
    await jobs.start("c", "long");
    await until(async () => (await jobs.log("c")).includes("i blocking"));
    const cli = async (...argv: string[]) => {
      const out: string[] = [];
      const exit = await runCli({ argv, env: {}, isTTY: false, isRoot: true, registry, makeLogger: () => log, profilesDir: "", version: "t", theme: { text: "", accent: "", ok: "", warn: "", error: "", info: "" }, out: (l) => void out.push(l) });
      return { exit, text: out.join("\n") };
    };
    expect((await cli("jobs")).text).toMatch(/jobber\/c {2}running/);
    expect((await cli("jobs", "log", "jobber", "c")).text).toContain("blocking");
    expect((await cli("jobs", "stop", "jobber", "c")).text).toContain("parado");
    expect((await cli("jobs", "list")).text).toMatch(/jobber\/c {2}stopped/);
    expect((await cli("jobs", "log", "jobber", "nope")).exit).toBe(3);
  }, 15_000);
});
