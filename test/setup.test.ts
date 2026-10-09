import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

test("PVX_HOME is isolated under the OS tmpdir", () => {
  const home = realpathSync(process.env.PVX_HOME!);
  expect(home.startsWith(realpathSync(tmpdir()))).toBe(true);
  expect(home).not.toBe("/etc/pvx");
});
