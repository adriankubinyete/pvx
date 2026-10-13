import { join } from "node:path";
import { theme, ui } from "@pvx/tui";
import { EXIT, type Logger } from "@pvx/sdk";
import { createLogger, createRegistry, loadModules, logsDir, runCli, trustGate } from "@pvx/core";
import { builtin } from "../../../packages/builtin/index.ts";
import { ask, askSecret } from "./prompt.ts";
import { VERSION, VERSION_LABEL } from "./version.ts";

// Dev layout; the compiled binary carries the profiles embedded and loadProfiles prefers them.
const PROFILES_DIR = join(import.meta.dir, "../../../profiles");

/** Logging is best effort: an unwritable PVX_HOME must not break read-only commands. */
const makeLogger = (name: string): Logger => {
  const real = createLogger(logsDir(), name);
  const safe = (f: (m: string) => void) => (m: string) => {
    try {
      f(m);
    } catch {}
  };
  return { debug: safe(real.debug), info: safe(real.info), warn: safe(real.warn), error: safe(real.error) };
};

async function main(): Promise<number> {
  const registry = createRegistry();
  // No env var bypasses trust: PVX_USERMODULES only moves the directory. Built-ins ship with pvx and skip the gate.
  // The login banner has 1 s: built-ins only (no git probe per usermodule); the notes it shows come from a built-in.
  const canImport = process.argv[2] === "banner" ? () => false : trustGate({ warn: (m) => makeLogger("core").warn(m) });
  await loadModules(registry, { hostVersion: VERSION, makeLogger, ui, builtin, canImport });
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const abort = new AbortController();
  // Only `logs -f` handles Ctrl+C; a global listener would swallow the first Ctrl+C of a hung command.
  const argv = process.argv.slice(2);
  if (argv[0] === "logs" && argv.some((a) => a === "-f" || a === "--follow")) process.once("SIGINT", () => abort.abort());
  const base = {
    env: process.env,
    isRoot: process.getuid?.() === 0,
    registry,
    makeLogger,
    profilesDir: PROFILES_DIR,
    version: VERSION_LABEL,
    theme,
  };
  const r = await runCli({
    ...base,
    argv,
    isTTY: tty,
    out: (line) => console.log(line),
    readStdin: () => Bun.stdin.text(),
    ask: tty ? ask : undefined,
    askSecret: tty ? askSecret : undefined,
    signal: abort.signal,
  });
  if (r === "tui") {
    await (await import("./tui.tsx")).openTui(base);
    return EXIT.OK;
  }
  return r;
}

try {
  process.exit(await main());
} catch (e) {
  makeLogger("core").error(`erro não tratado: ${(e as Error).stack ?? e}`);
  console.error(`[✗] erro interno: ${(e as Error).message}`);
  process.exit(EXIT.ERROR);
}
