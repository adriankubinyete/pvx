import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { moduleStateDir } from "@pvx/core";
import { renderPage, runCommand, runSession, type TuiHarness } from "../src/index.ts";

const demo = join(import.meta.dir, "../../core/test/fixtures/usermodules/ui-demo");
let t: TuiHarness | undefined;
afterEach(() => t?.destroy());

test("runCommand loads one module and returns ok, exit and lines", async () => {
  const r = await runCommand(demo, "ui-demo status");
  expect(r).toEqual({ ok: true, exit: 0, lines: [{ kind: "success", text: "status ok" }] });
  expect((await runCommand(demo, "ui-demo nope")).exit).toBe(3);
});

test("renderPage mounts the page with the real sdk.ui; keys and useState work", async () => {
  t = await renderPage(demo, "counter", { cols: 80, rows: 24 });
  expect(t.frame()).toContain("n = 0");
  await t.press(" ");
  expect(t.frame()).toContain("n = 1");
});

test("renderPage names the pages that exist when the name is wrong", async () => {
  await expect(renderPage(demo, "nope")).rejects.toThrow(/counter/);
});

test("runSession shares one home between runs and the page", async () => {
  const s = await runSession(join(import.meta.dir, "../../core/test/fixtures/usermodules/demo"));
  expect(existsSync(join(moduleStateDir("demo"), "state.json"))).toBe(false);
  expect((await s.run("demo greet bob")).text).toBe("oi bob");
  await s.run("demo remember");
  expect(existsSync(join(moduleStateDir("demo"), "state.json"))).toBe(true); // still there for the next line
  expect(moduleStateDir("demo").startsWith(s.home)).toBe(true);
  expect((await s.run("demo wipe")).exit).toBe(2);
  expect((await s.run("demo wipe", { confirmed: true })).ok).toBe(true);

  const ui = await runSession(demo);
  t = await ui.renderPage("counter", { cols: 80, rows: 24 });
  expect(t.frame()).toContain("n = 0");
});

const machine = join(import.meta.dir, "fixtures/machine-demo");

test("onFakeMachine: the real factory runs on the fake machine, as non-root and then as root", async () => {
  const { system } = await import("./fixtures/machine-demo/index.ts");
  const denied = await runCommand(machine, "machine-demo run");
  expect(denied.lines.map((line) => line.text)).toEqual(["precisa de root"]);
  expect(system.calls).toEqual([]);

  system.isRoot = true; // the fake machine decides ctx.isRoot
  const session = await runSession(machine);
  const ran = await session.run("machine-demo run");
  expect(ran.text).toBe("rodou");
  expect(system.calls.map((call) => call.cmd)).toEqual(["tool"]);
  expect(system.lines()).toEqual(["tool go"]);
  expect(system.fs.files.get("/etc/machine-demo/marker")).toBe("feito");
  expect(existsSync("/etc/machine-demo/marker")).toBe(false); // nothing real was written
});
