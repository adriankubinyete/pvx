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
