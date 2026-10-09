import { join } from "node:path";
import { theme } from "@pvx/tui";
import { EXIT, type Logger } from "@pvx/sdk";
import { createLogger, createRegistry, loadModules, logsDir, runCli } from "@pvx/core";
import { ask, askSecret } from "./prompt.ts";

const VERSION = "0.1.0";
// Dev layout. The compiled binary will need the profiles embedded (Fase 8).
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
  await loadModules(registry, { hostVersion: VERSION, makeLogger });
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const abort = new AbortController();
  // Only `logs -f` handles Ctrl+C; a global listener would swallow the first Ctrl+C of a hung command.
  const argv = process.argv.slice(2);
  if (argv[0] === "logs" && argv.some((a) => a === "-f" || a === "--follow")) process.once("SIGINT", () => abort.abort());
  const r = await runCli({
    argv,
    env: process.env,
    isTTY: tty,
    isRoot: process.getuid?.() === 0,
    registry,
    makeLogger,
    profilesDir: PROFILES_DIR,
    version: VERSION,
    theme,
    out: (line) => console.log(line),
    readStdin: () => Bun.stdin.text(),
    ask: tty ? ask : undefined,
    askSecret: tty ? askSecret : undefined,
    signal: abort.signal,
  });
  if (r === "tui") {
    await (await import("./tui.tsx")).openTui();
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
