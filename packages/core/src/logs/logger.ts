import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../../../sdk/src/index.ts";

export const MAX_BYTES = 1024 * 1024;
export const BACKUPS = 3;

/** Default logs dir. Read at call time. */
export const defaultLogsDir = () => join(process.env.PVX_HOME ?? "/etc/pvx", "logs");

export interface LoggerOptions {
  maxBytes?: number;
  backups?: number;
}

function rotate(file: string, backups: number) {
  rmSync(`${file}.${backups}`, { force: true });
  for (let i = backups - 1; i >= 1; i--) {
    try {
      renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {}
  }
  try {
    renameSync(file, `${file}.1`);
  } catch {}
}

/**
 * Line: `<ISO ts> LEVEL name: message`. Continuation lines of a multi-line
 * message are prefixed with a tab, so readers can attach them to their entry.
 */
export function createLogger(logsDir: string, name: string, opts: LoggerOptions = {}): Logger {
  const file = join(logsDir, `${name}.log`);
  const { maxBytes = MAX_BYTES, backups = BACKUPS } = opts;
  const write = (level: string, msg: string) => {
    const [first = "", ...rest] = msg.split("\n");
    const text = [`${new Date().toISOString()} ${level} ${name}: ${first}`, ...rest.map((l) => `\t${l}`)].join("\n") + "\n";
    mkdirSync(logsDir, { recursive: true });
    try {
      if (statSync(file).size >= maxBytes) rotate(file, backups);
    } catch {}
    appendFileSync(file, text);
  };
  return {
    debug: (m) => write("DEBUG", m),
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERROR", m),
  };
}
