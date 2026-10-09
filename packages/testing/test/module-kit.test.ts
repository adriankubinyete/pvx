import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { renderPage, runCommand, type TuiHarness } from "../src/index.ts";

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
