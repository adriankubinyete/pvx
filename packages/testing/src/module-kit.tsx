import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger, createRegistry, execute, loadModules, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import type { OutLine } from "@pvx/sdk";
import { App, createSessionStore, createTabsNav, Tabs, theme, ui } from "@pvx/tui";
import { pageScreen } from "../../tui/src/sdk-ui/index.tsx";
import { renderTui, type TuiHarness } from "./render-tui.ts";

const HOST_VERSION = "0.1.0";
const homes: string[] = [];
process.on("exit", () => homes.forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * Loads ONE module (a symlink to `moduleDir` in a fresh `usermodules/`) through the real loader, with a temp `PVX_HOME`.
 * It points PVX_HOME and PVX_USERMODULES at the temp dirs and leaves them set: a test file owns the process env.
 */
async function loadOne(moduleDir: string, sshClient?: string, isRoot?: boolean): Promise<{ registry: Registry; id: string; home: string }> {
  const dir = resolve(moduleDir);
  const { id } = JSON.parse(readFileSync(join(dir, "pvx-module.json"), "utf8")) as { id: string };
  const home = mkdtempSync(join(tmpdir(), "pvx-mod-"));
  homes.push(home);
  mkdirSync(join(home, "usermodules"));
  symlinkSync(dir, join(home, "usermodules", id));
  process.env.PVX_HOME = home;
  process.env.PVX_USERMODULES = join(home, "usermodules");
  const registry = createRegistry();
  await loadModules(registry, { hostVersion: HOST_VERSION, makeLogger: (n) => createLogger(logsDir(), n), ui, session: { sshClient }, isRoot });
  const err = registry.errors[0];
  if (err) throw new Error(`módulo "${err.id}" não carregou: ${err.error}`);
  return { registry, id, home };
}

export interface RunCommandOpts {
  env?: Record<string, string>;
  /** Secret args by name, as the host would hand them over (`PVX_SECRET_<NAME>`). */
  secrets?: Record<string, string>;
  /** Same as `--yes`: lets a `destructive` command run. */
  confirmed?: boolean;
  /** `ctx.session.sshClient` of the commands. Default: none (a test never reads the real session of the machine). */
  sshClient?: string;
  /** `ctx.isRoot` of the commands. Default: the real process (a page and a session default to root). */
  isRoot?: boolean;
}

const runOn = async (registry: Registry, line: string, opts: RunCommandOpts) => {
  const secretEnv = Object.fromEntries(Object.entries(opts.secrets ?? {}).map(([k, v]) => [`PVX_SECRET_${k.toUpperCase().replace(/-/g, "_")}`, v]));
  const { ok, exit, lines } = await execute(registry, line, {
    makeLogger: (n) => createLogger(logsDir(), n),
    env: { ...opts.env, ...secretEnv },
    confirmed: opts.confirmed,
    session: { sshClient: opts.sshClient },
    isRoot: opts.isRoot,
  });
  return { ok, exit, lines, text: lines.map((l) => l.text).join("\n") };
};

/** Runs a command line (`"<id> status --flag"`, module id first, as in the CLI) through the core `execute`, in a fresh home. */
export async function runCommand(moduleDir: string, line: string, opts: RunCommandOpts = {}): Promise<{ ok: boolean; exit: number; lines: OutLine[] }> {
  const { ok, exit, lines } = await runOn((await loadOne(moduleDir, opts.sshClient, opts.isRoot)).registry, line, opts);
  return { ok, exit, lines };
}

const sessionOf = (registry: Registry, isRoot: boolean, sshClient: string | undefined) => {
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const session = createSessionStore({
    registry, makeLogger, isRoot, session: { sshClient }, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: HOST_VERSION, theme }, argv),
  });
  return { makeLogger, session };
};

interface MountSize { cols?: number; rows?: number; isRoot?: boolean; sshClient?: string }

const registeredPage = (registry: Registry, id: string, pageName: string) => {
  const page = registry.pages.get(`${id}.${pageName}`);
  if (!page) throw new Error(`página "${pageName}" não existe em "${id}" (tem: ${[...registry.pages.keys()].join(", ") || "nenhuma"})`);
  return page;
};

const mount = async (registry: Registry, id: string, pageName: string, { cols = 100, rows = 30, isRoot = true, sshClient }: MountSize = {}): Promise<TuiHarness> => {
  const page = registeredPage(registry, id, pageName);
  const { makeLogger, session } = sessionOf(registry, isRoot, sshClient);
  return renderTui(
    <App root={pageScreen(page)} logger={makeLogger(id)} onExit={() => {}} statePath={join(pvxHome(), "tui-state.json")} pages={{ session, registry, makeLogger, isRoot }} />,
    { cols, rows },
  );
};

/** The real shell (tab bar, footer) with the page open as its tab and the keyboard inside it: what a technician sees after entering the tab. */
const mountTab = async (registry: Registry, id: string, pageName: string, { cols = 100, rows = 30, isRoot = true, sshClient }: MountSize = {}): Promise<TuiHarness> => {
  registeredPage(registry, id, pageName);
  const { makeLogger, session } = sessionOf(registry, isRoot, sshClient);
  const nav = createTabsNav();
  nav.active = `page:${id}.${pageName}`;
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={session} registry={registry} nav={nav} version={HOST_VERSION} /> };
  return renderTui(
    <App root={root} logger={makeLogger(id)} onExit={() => {}} statePath={join(pvxHome(), "tui-state.json")} pages={{ session, registry, makeLogger, isRoot }} />,
    { cols, rows },
  );
};

/** Mounts the module's page `pageName` with the real host `sdk.ui` in a headless terminal, in a fresh home. Call `destroy()` at the end. */
export async function renderPage(moduleDir: string, pageName: string, size: { cols?: number; rows?: number; sshClient?: string; isRoot?: boolean } = {}): Promise<TuiHarness> {
  const { registry, id } = await loadOne(moduleDir, size.sshClient, size.isRoot);
  return mount(registry, id, pageName, size);
}

/** Like `renderPage`, but the page is a tab of the real shell and the keyboard is inside it (the page needs `tab`). Use it for `expectNoKeyboardTrap`. */
export async function renderTab(moduleDir: string, pageName: string, size: MountSize = {}): Promise<TuiHarness> {
  const { registry, id } = await loadOne(moduleDir, size.sshClient, size.isRoot);
  return mountTab(registry, id, pageName, size);
}

export interface Session {
  /** The temp `PVX_HOME` every call of this session shares. */
  home: string;
  /** Runs a line in the shared home: what an earlier line stored is there for the next one. `text` is the line texts joined by newlines. */
  run(line: string, opts?: RunCommandOpts): Promise<{ ok: boolean; exit: number; lines: OutLine[]; text: string }>;
  /** Mounts a page of the module on the same home (the same state the `run` calls left). Call `destroy()` at the end. */
  renderPage(pageName: string, size?: { cols?: number; rows?: number }): Promise<TuiHarness>;
  /** Mounts a page of the module as a tab of the real shell, the keyboard inside it (see `renderTab`). */
  renderTab(pageName: string, size?: { cols?: number; rows?: number }): Promise<TuiHarness>;
}

/** Like `runCommand` and `renderPage`, but ONE temp `PVX_HOME` for several calls, so a test can run a sequence ("add", then "list") and then look at the page. */
export async function runSession(moduleDir: string, { sshClient, isRoot }: { sshClient?: string; isRoot?: boolean } = {}): Promise<Session> {
  const { registry, id, home } = await loadOne(moduleDir, sshClient, isRoot);
  return { home, run: (line, opts = {}) => runOn(registry, line, { sshClient, isRoot, ...opts }), renderPage: (pageName, size) => mount(registry, id, pageName, { isRoot, sshClient, ...size }), renderTab: (pageName, size) => mountTab(registry, id, pageName, { isRoot, sshClient, ...size }) };
}
