import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger, createRegistry, execute, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import type { OutLine } from "@pvx/sdk";
import { App, createSessionStore, theme, ui } from "@pvx/tui";
import { pageScreen } from "../../tui/src/sdk-ui/index.tsx";
import { renderTui, type TuiHarness } from "./render-tui.ts";

const HOST_VERSION = "0.1.0";
const homes: string[] = [];
process.on("exit", () => homes.forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * Loads ONE module (a symlink to `moduleDir` in a fresh `usermodules/`) through the real loader, with a temp `PVX_HOME`.
 * It points PVX_HOME and PVX_USERMODULES at the temp dirs and leaves them set: a test file owns the process env.
 */
async function loadOne(moduleDir: string): Promise<{ registry: Registry; id: string }> {
  const dir = resolve(moduleDir);
  const { id } = JSON.parse(readFileSync(join(dir, "pvx-module.json"), "utf8")) as { id: string };
  const home = mkdtempSync(join(tmpdir(), "pvx-mod-"));
  homes.push(home);
  mkdirSync(join(home, "usermodules"));
  symlinkSync(dir, join(home, "usermodules", id));
  process.env.PVX_HOME = home;
  process.env.PVX_USERMODULES = join(home, "usermodules");
  const registry = createRegistry();
  await loadModules(registry, { hostVersion: HOST_VERSION, makeLogger: (n) => createLogger(logsDir(), n), ui });
  const err = registry.errors[0];
  if (err) throw new Error(`módulo "${err.id}" não carregou: ${err.error}`);
  return { registry, id };
}

export interface RunCommandOpts {
  env?: Record<string, string>;
  /** Secret args by name, as the host would hand them over (`PVX_SECRET_<NAME>`). */
  secrets?: Record<string, string>;
  /** Same as `--yes`: lets a `destructive` command run. */
  confirmed?: boolean;
}

/** Runs a command line (`"<id> status --flag"`, module id first, as in the CLI) through the core `execute`. */
export async function runCommand(moduleDir: string, line: string, opts: RunCommandOpts = {}): Promise<{ ok: boolean; exit: number; lines: OutLine[] }> {
  const { registry } = await loadOne(moduleDir);
  const secretEnv = Object.fromEntries(Object.entries(opts.secrets ?? {}).map(([k, v]) => [`PVX_SECRET_${k.toUpperCase().replace(/-/g, "_")}`, v]));
  const { ok, exit, lines } = await execute(registry, line, {
    makeLogger: (n) => createLogger(logsDir(), n),
    env: { ...opts.env, ...secretEnv },
    confirmed: opts.confirmed,
  });
  return { ok, exit, lines };
}

/** Mounts the module's page `pageName` with the real host `sdk.ui` in a headless terminal. Call `destroy()` at the end. */
export async function renderPage(moduleDir: string, pageName: string, { cols = 100, rows = 30 }: { cols?: number; rows?: number } = {}): Promise<TuiHarness> {
  const { registry, id } = await loadOne(moduleDir);
  const page = registry.pages.get(`${id}.${pageName}`);
  if (!page) throw new Error(`página "${pageName}" não existe em "${id}" (tem: ${[...registry.pages.keys()].join(", ") || "nenhuma"})`);
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const session = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: HOST_VERSION, theme }, argv),
  });
  return renderTui(
    <App root={pageScreen(page)} logger={makeLogger(id)} onExit={() => {}} statePath={join(pvxHome(), "tui-state.json")} pages={{ session, registry, makeLogger }} />,
    { cols, rows },
  );
}
