import { expect, test } from "bun:test";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pvxHome } from "@pvx/core";
import { runDevLink } from "../scripts/dev-link.ts";

// @pvx/testing leaves PVX_USERMODULES set in the process; the script uses the one under PVX_HOME.
delete process.env.PVX_USERMODULES;

const templateDir = realpathSync(join(import.meta.dir, "..", "templates", "pvx-module-template"));

test("dev:link registers a module dir in PVX_HOME, lists it and unlinks it", () => {
  expect(runDevLink("link")).toEqual(["nenhum módulo linkado"]);

  const lines = runDevLink("link", templateDir);
  expect(lines).toContain(`path: ${templateDir}`);
  const id = lines.find((line) => line.startsWith("id: "))!.slice(4);
  expect(lstatSync(join(pvxHome(), "usermodules", id)).isSymbolicLink()).toBe(true);
  expect(runDevLink("link")).toEqual([`${id} -> ${templateDir}`]);

  runDevLink("unlink", id);
  expect(existsSync(join(pvxHome(), "usermodules", id))).toBe(false);
  expect(runDevLink("link")).toEqual(["nenhum módulo linkado"]);
});

test("dev:link rejects a path that does not exist or has no manifest", () => {
  expect(() => runDevLink("link", join(templateDir, "nope"))).toThrow();
  expect(() => runDevLink("link", join(templateDir, "src"))).toThrow();
});
