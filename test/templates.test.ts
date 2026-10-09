import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, createRegistry, execute, loadModules, logsDir } from "@pvx/core";

test("the module template loads from a copy in usermodules/ (no repo resolution) and runs its command", async () => {
  const root = mkdtempSync(join(tmpdir(), "pvx-tpl-"));
  mkdirSync(join(root, "usermodules"));
  cpSync(join(import.meta.dir, "../templates/pvx-module-template"), join(root, "usermodules/exemplo"), { recursive: true });
  process.env.PVX_USERMODULES = join(root, "usermodules");
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const registry = createRegistry();
  // No `ui`: the factory may destructure `sdk.ui` at load time, and `saudar` does not touch it.
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger });
  expect(registry.errors).toEqual([]);
  const r = await execute(registry, "exemplo saudar Ana", { makeLogger });
  expect(r.lines).toEqual([{ kind: "success", text: "olá, Ana" }]);
  expect(registry.capabilities.map((c) => c.id)).toEqual(["exemplo.saudacao"]);
});
