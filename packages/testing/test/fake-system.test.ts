import { expect, test } from "bun:test";
import type { CommandDef } from "@pvx/sdk";
import { fakeCommandCtx, fakeReadCtx, fakeSdk, fakeSystem } from "../src/index.ts";

/** A command written the way a module writes one: over `ctx.shell`, `ctx.fs` and `ctx.phases`. */
const install: CommandDef = {
  help: "instala",
  async run(ctx) {
    await ctx.phases.run("setup", [
      {
        id: "pacotes",
        label: "pacotes",
        run: async () => {
          await ctx.shell.must("dnf", ["install", "-y", "httpd"]);
        },
      },
      { id: "segredo", label: "segredo", run: () => ctx.fs.write("/etc/app/pass", "s3", { mode: 0o600, atomic: true }) },
    ]);
  },
};

test("a command runs against a fake system: calls, files, modes and output are all readable", async () => {
  const system = fakeSystem({ rules: [(call) => (call.cmd === "dnf" ? { lines: ["Complete!"] } : undefined)] });
  const ctx = fakeCommandCtx(system);
  await install.run(ctx);
  expect(system.lines()).toEqual(["dnf install -y httpd"]);
  expect(system.fs.files.get("/etc/app/pass")).toBe("s3");
  expect(system.fs.modes.get("/etc/app/pass")).toBe(0o600);
  expect(ctx.lines.map((line) => line.text)).toContain("fase pacotes: concluída");
});

test("a failing program makes ctx.shell.must throw a StepError the phase runner records", async () => {
  const system = fakeSystem({ rules: [(call) => (call.cmd === "dnf" ? { code: 1, lines: ["Error: no match for httpd"] } : undefined)] });
  await install.run(fakeCommandCtx(system));
  const state = system.store.get<{ failure?: { command?: string; output?: string[] } }>("phases:setup");
  expect(state?.failure).toMatchObject({ command: "dnf install -y httpd", output: ["Error: no match for httpd"] });
});

test("fakeReadCtx and fakeSdk give proofs and queries the same fakes", async () => {
  const system = fakeSystem({ files: { "/etc/os-release": "ID=rocky" } });
  const read = fakeReadCtx(system);
  expect(await read.fs.read("/etc/os-release")).toBe("ID=rocky");
  expect(await fakeSdk().strategy.pick([{ id: "nft", available: () => true }], { none: "nenhum" })).toMatchObject({ auto: true });
});

test("the stderr of a fake reply reaches onLine and the shell tail, as real exec does", async () => {
  const system = fakeSystem({ rules: [(call) => (call.cmd === "dnf" ? { code: 1, stderr: "Error: no match for httpd\n\nlast line" } : undefined)] });
  const seen: string[] = [];
  const result = await fakeCommandCtx(system).shell.run("dnf", ["install"], { onLine: (line, stream) => void seen.push(`${stream}:${line}`) });
  expect(seen).toEqual(["stderr:Error: no match for httpd", "stderr:last line"]);
  expect(result.tail).toEqual(["Error: no match for httpd", "last line"]);
});

test("the fake contexts carry strategy, the probe shell, the errors kit and sshClient", async () => {
  const system = fakeSystem({ rules: [(call) => (call.cmd === "nft" ? { code: 1 } : undefined)], sshClient: "10.0.0.9" });
  const read = fakeReadCtx(system);
  expect(await read.shell.ok("nft", ["list", "ruleset"])).toBe(false);
  expect((await read.shell.run("true")).code).toBe(0);
  expect(await read.strategy.pick([{ id: "nft", available: () => true }], { none: "nenhum" })).toMatchObject({ auto: true });
  expect(read.session.sshClient).toBe("10.0.0.9");
  expect(fakeCommandCtx(system).session.sshClient).toBe("10.0.0.9");
  expect(fakeSdk().errors.describeFailure(new Error("x"))).toBe("x");
});

test("fakeSystem takes a clock and isRoot, and fakeCommandCtx takes a signal", async () => {
  const clock = { now: 5000 };
  const stop = new AbortController();
  const system = fakeSystem({ clock, isRoot: false });
  const ctx = fakeCommandCtx(system, { signal: stop.signal });
  expect(ctx.isRoot).toBe(false);
  expect(fakeReadCtx(system).isRoot).toBe(false);
  expect(fakeSystem().isRoot).toBe(true);
  expect(ctx.signal).toBe(stop.signal);
  await ctx.phases.run("n", [{ id: "a", label: "a", run: () => {} }]);
  expect(ctx.phases.state("n")?.startedAt).toBe(5000);
  clock.now = 9000;
  expect(system.now()).toBe(9000);
});

test("shell.echoing on the fake ctx writes the jobLines and runs with ctx.signal", async () => {
  const system = fakeSystem({ rules: [(call) => (call.cmd === "dnf" ? { lines: ["Complete!"] } : undefined)] });
  const ctx = fakeCommandCtx(system);
  await ctx.shell.echoing({ timeoutMs: 1000 }).must("dnf", ["install", "-y", "httpd"]);
  expect(ctx.jobLines).toEqual(["$ dnf install -y httpd", "Complete!"]);
});
