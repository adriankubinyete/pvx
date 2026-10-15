import { beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger, Manifest } from "@pvx/sdk";
import {
  commitLabel, createRegistry, devMark, embeddedText, linkModule, listModules, loadModules, moduleStateDir, reconcileModule, runCli, shadowNotice, trustGate,
  type EmbeddedModule, type LoadOpts,
} from "../../src/index.ts";

const noop = () => {};
const makeLogger = (): Logger => ({ debug: noop, info: noop, warn: noop, error: noop });
const theme = { text: "#fff", accent: "#0f0", warn: "#ff0", error: "#f00", info: "#00f" };
const FIXTURES = join(import.meta.dir, "../fixtures/usermodules");

beforeEach(() => {
  process.env.PVX_USERMODULES = join(process.env.PVX_HOME!, "usermodules");
});

/** An embedded module with the id of the `demo` fixture, so an installed `demo` has something to lose to. */
function embeddedDemo(dirty = false): EmbeddedModule {
  const manifest: Manifest = { id: "demo", version: "9.9.9", entry: "x" };
  return {
    manifest,
    info: { id: "demo", version: "9.9.9", source: "/work/pvx-demo", commit: "abc1234", dirty },
    factory: () => ({
      commands: {
        remember: { help: "Saves a value", readonly: true, run: (ctx) => ctx.store.set("seen", "yes") },
      },
    }),
  };
}

function installDemoOnDisk(): string {
  const dir = join(process.env.PVX_USERMODULES!, "demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pvx-module.json"), JSON.stringify({ id: "demo", version: "1.0.0", entry: "index.ts" }));
  writeFileSync(join(dir, "index.ts"), 'throw new Error("the installed copy must never be imported");\n');
  return dir;
}

const options = (extra: Partial<LoadOpts> = {}): LoadOpts => ({ hostVersion: "0.1.0", makeLogger, ...extra });

test("an embedded module loads without the trust prompt, even when every gate says no", async () => {
  const registry = createRegistry();
  await loadModules(registry, options({ embedded: [embeddedDemo()], canImport: () => false }));
  expect(registry.modules.get("demo")?.version).toBe("9.9.9");
  expect(registry.embedded.get("demo")).toEqual(embeddedDemo().info);
  expect(registry.official.has("demo")).toBe(false);
  expect(registry.errors).toEqual([]);
  expect(registry.warnings).toEqual([]);
});

test("an installed module of the same id loses to the embedded copy, with an aviso and nothing changed on disk", async () => {
  const dir = installDemoOnDisk();
  const before = readFileSync(join(dir, "index.ts"), "utf8");
  const registry = createRegistry();
  await loadModules(registry, options({ embedded: [embeddedDemo()], canImport: trustGate() }));
  expect(registry.modules.get("demo")?.version).toBe("9.9.9");
  expect(registry.errors).toEqual([]); // the installed copy was never imported (it throws)
  expect(registry.warnings).toEqual(["demo: usando a cópia embutida no binário dev; a instalada foi ignorada"]);
  expect(registry.warnings).toEqual([shadowNotice("demo")]);
  expect(readFileSync(join(dir, "index.ts"), "utf8")).toBe(before);
  expect(readdirSync(dir).sort()).toEqual(["index.ts", "pvx-module.json"]);
  expect(existsSync(join(process.env.PVX_HOME!, "trust.json"))).toBe(false);
});

test("a linked dev module of the same id loses too", async () => {
  expect(linkModule(join(FIXTURES, "demo")).ok).toBe(true);
  const registry = createRegistry();
  await loadModules(registry, options({ embedded: [embeddedDemo()], canImport: trustGate() }));
  expect(registry.modules.get("demo")?.version).toBe("9.9.9");
  expect(registry.warnings).toEqual([shadowNotice("demo")]);
});

test("listModules shows one row for the id, marked embedded, and never the installed copy", async () => {
  installDemoOnDisk();
  const registry = createRegistry();
  await loadModules(registry, options({ embedded: [embeddedDemo(true)], canImport: trustGate() }));
  const rows = (await listModules(registry)).filter((row) => row.id === "demo");
  expect(rows).toEqual([{ id: "demo", state: "carregado", version: "9.9.9", embedded: { id: "demo", version: "9.9.9", source: "/work/pvx-demo", commit: "abc1234", dirty: true } }]);
});

test("a reconcile of the embedded id leaves it alone (trusting the installed copy changes nothing)", async () => {
  installDemoOnDisk();
  const registry = createRegistry();
  const load = options({ embedded: [embeddedDemo()], canImport: trustGate() });
  await loadModules(registry, load);
  await reconcileModule(registry, "demo", load);
  expect(registry.modules.get("demo")?.version).toBe("9.9.9");
  expect(registry.embedded.has("demo")).toBe(true);
});

test("state goes to the normal module state dir, so it survives switching binaries", async () => {
  const registry = createRegistry();
  await loadModules(registry, options({ embedded: [embeddedDemo()] }));
  const exit = await runCli({ argv: ["demo", "remember"], env: { NO_COLOR: "1" }, isTTY: false, isRoot: true, registry, makeLogger, profilesDir: "", version: "0.1.0", theme, out: noop });
  expect(exit).toBe(0);
  expect(JSON.parse(readFileSync(join(moduleStateDir("demo"), "state.json"), "utf8"))).toEqual({ seen: "yes" });
});

test("version --json and the modules list carry the embedded modules; text mode prints them too", async () => {
  const registry = createRegistry();
  await loadModules(registry, options({ embedded: [embeddedDemo(true)] }));
  const run = async (argv: string[]) => {
    const out: string[] = [];
    const io = { argv, env: { NO_COLOR: "1" }, isTTY: false, isRoot: true, registry, makeLogger, profilesDir: "", version: "0.1.0 (dev, +demo)", build: "dev-build:20261015.1432-4d8baf8", theme, out: (line: string) => void out.push(line) };
    await runCli(io);
    return out;
  };
  const json = JSON.parse((await run(["version", "--json"])).join("")) as { lines: { kind: string; text: string; build?: unknown }[] };
  expect(json.lines[0]).toEqual({
    kind: "plain",
    text: "pvx 0.1.0 (dev, +demo)",
    build: {
      version: "0.1.0",
      label: "0.1.0 (dev, +demo)",
      buildId: "dev-build:20261015.1432-4d8baf8",
      embedded: [{ id: "demo", version: "9.9.9", source: "/work/pvx-demo", commit: "abc1234", dirty: true }],
    },
  });
  expect(await run(["version"])).toEqual(["pvx 0.1.0 (dev, +demo)", "embutido (dev): demo 9.9.9 abc1234* (/work/pvx-demo)"]);
  expect((await run(["--version"]))[0]).toBe("pvx 0.1.0 (dev, +demo)");
  expect((await run(["modules"])).join("\n")).toContain("demo 9.9.9 carregado embutido (dev) abc1234*");
});

test("a release build has no embedded modules: the version has one line and no build field", async () => {
  const registry = createRegistry();
  const out: string[] = [];
  await runCli({ argv: ["version", "--json"], env: {}, isTTY: false, isRoot: true, registry, makeLogger, profilesDir: "", version: "0.1.0", theme, out: (line) => void out.push(line) });
  const [line] = (JSON.parse(out.join("")) as { lines: { build: object }[] }).lines;
  expect(line!.build).toEqual({ version: "0.1.0", label: "0.1.0", embedded: [] });
});

test("the dev mark follows the nightly format: dev, then +id for each module", () => {
  expect(devMark(["firewall", "autobackup"])).toBe("dev, +firewall +autobackup");
  expect(devMark([])).toBe("dev");
  expect(commitLabel({ commit: "abc1234", dirty: false })).toBe("abc1234");
  expect(commitLabel({ commit: "abc1234", dirty: true })).toBe("abc1234*");
  expect(embeddedText(embeddedDemo().info)).toBe("demo 9.9.9 abc1234 (/work/pvx-demo)");
});
