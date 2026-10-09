import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir } from "@pvx/core";
import { ui } from "@pvx/tui";

const root = join(import.meta.dir, "..");
const readme = readFileSync(join(root, "packages/sdk/README.md"), "utf8");
// A fence right after `<!-- test -->` is a whole module: it is loaded by the real loader and typechecked.
const examples = [...readme.matchAll(/<!-- test -->\n```(tsx?)\n([\s\S]*?)```/g)].map((m) => ({ ext: m[1]!, code: m[2]! }));

test("README has tagged examples", () => expect(examples.length).toBeGreaterThanOrEqual(5));

test("every tagged README example loads and typechecks", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pvx-readme-"));
  process.env.PVX_HOME = tmp;
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  for (const [i, { ext, code }] of examples.entries()) {
    const dir = join(tmp, `ex${i}`, "doc"); // usermodules dir of example i; the module id is `doc`
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "pvx-module.json"), JSON.stringify({ id: "doc", version: "0.0.1", entry: `src/index.${ext}` }));
    writeFileSync(join(dir, "src", `index.${ext}`), code);
    process.env.PVX_USERMODULES = join(tmp, `ex${i}`);
    const registry = createRegistry();
    await loadModules(registry, { hostVersion: "0.1.0", makeLogger, ui });
    expect({ example: i, errors: registry.errors }).toEqual({ example: i, errors: [] });
  }
  // The root tsconfig carries the `@pvx/*` paths, `strict` and `jsx` settings.
  writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({ extends: join(root, "tsconfig.json"), compilerOptions: { types: [] }, include: ["*/doc/src/*"] }));
  const p = Bun.spawnSync([join(root, "node_modules/.bin/tsc"), "-p", join(tmp, "tsconfig.json")], { cwd: root });
  expect(p.stdout.toString() + p.stderr.toString()).toBe("");
}, 30_000);
