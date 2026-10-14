import { readFileSync, readlinkSync } from "node:fs";
import { isIP } from "node:net";
import type { SessionInfo } from "@pvx/sdk";

export type SshSource = "env" | "ancestor" | "who";

export interface SshClient {
  ip: string;
  source: SshSource;
}

/** What the detection touches, so a test hands it a fake machine. Every reader answers undefined instead of throwing. */
export interface SshSeams {
  env: Record<string, string | undefined>;
  /** Text of a file (`/proc/<pid>/status`, `/proc/<pid>/environ`). */
  readFile(path: string): string | undefined;
  /** Target of a symlink (`/proc/self/fd/0`). */
  readLink(path: string): string | undefined;
  /** Output of plain `who`. */
  runWho(): string | undefined;
}

const SSH_VARIABLES = ["SSH_CONNECTION", "SSH_CLIENT"];
/** The shell chain between pvx and sshd is short; the cap only protects against a broken /proc. */
const MAX_ANCESTORS = 64;
const STD_FDS = [0, 1, 2];
const DEV_PREFIX = "/dev/";
/** The `(ip)` that ends a `who` line. */
const WHO_ORIGIN = /\(([^()\s]+)\)\s*$/;
const PPID_LINE = /^PPid:\s*(\d+)/m;

// ---- pure parsing

/** First word of an `SSH_CONNECTION` / `SSH_CLIENT` value (`client cport server sport`), when it is an IP. */
function ipFromSshVariable(value: string | undefined): string | undefined {
  const firstWord = value?.trim().split(/\s+/)[0];
  if (firstWord && isIP(firstWord) !== 0) return firstWord;
}

function ipFromVariables(lookup: (name: string) => string | undefined): string | undefined {
  for (const name of SSH_VARIABLES) {
    const ip = ipFromSshVariable(lookup(name));
    if (ip) return ip;
  }
}

/** The value of `name` in a `/proc/<pid>/environ` text (`NAME=value`, NUL separated). */
function environValue(environ: string, name: string): string | undefined {
  for (const entry of environ.split("\0")) {
    if (entry.startsWith(`${name}=`)) return entry.slice(name.length + 1);
  }
}

function parentPid(status: string): number | undefined {
  const match = PPID_LINE.exec(status);
  if (match) return Number(match[1]);
}

/** The `(ip)` of the `who` line whose terminal is `tty` (`pts/3`). `(:0)` and `(tmux(12).%0)` are not IPs and give nothing. */
export function ipFromWho(output: string, tty: string): string | undefined {
  for (const line of output.split("\n")) {
    if (line.trim().split(/\s+/)[1] !== tty) continue;
    const origin = WHO_ORIGIN.exec(line)?.[1];
    if (origin && isIP(origin) !== 0) return origin;
  }
}

// ---- the three attempts

function fromEnv(seams: SshSeams): SshClient | undefined {
  const ip = ipFromVariables((name) => seams.env[name]);
  if (ip) return { ip, source: "env" };
}

function ipFromAncestor(seams: SshSeams, pid: number): string | undefined {
  const environ = seams.readFile(`/proc/${pid}/environ`);
  if (environ === undefined) return undefined;
  return ipFromVariables((name) => environValue(environ, name));
}

/** `sudo`, `sudo -i` and `su -` reset the environment, but the login shell above them keeps it. Root can read every environ. */
function fromAncestors(seams: SshSeams): SshClient | undefined {
  let pid = process.pid;
  for (let step = 0; step < MAX_ANCESTORS; step++) {
    const status = seams.readFile(`/proc/${pid}/status`);
    const parent = status === undefined ? undefined : parentPid(status);
    if (parent === undefined || parent <= 1) return undefined;
    const ip = ipFromAncestor(seams, parent);
    if (ip) return { ip, source: "ancestor" };
    pid = parent;
  }
}

/** The terminal of pvx (`pts/3`), from the first standard stream that is one. */
function controllingTty(seams: SshSeams): string | undefined {
  for (const fd of STD_FDS) {
    const target = seams.readLink(`/proc/self/fd/${fd}`);
    if (target?.startsWith(DEV_PREFIX)) return target.slice(DEV_PREFIX.length);
  }
}

function fromWho(seams: SshSeams): SshClient | undefined {
  const tty = controllingTty(seams);
  if (!tty) return undefined;
  const output = seams.runWho();
  if (output === undefined) return undefined;
  const ip = ipFromWho(output, tty);
  if (ip) return { ip, source: "who" };
}

/**
 * The SSH client of the operator, in order: the environment of pvx, the environment of an ancestor process (survives `sudo`),
 * the `who` line of the terminal. Undefined on a console or serial login. The `/proc` steps find nothing outside Linux.
 */
export function detectSshClient(seams: SshSeams = realSeams()): SshClient | undefined {
  return fromEnv(seams) ?? fromAncestors(seams) ?? fromWho(seams);
}

// ---- the real machine

function quietly<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function runWhoNow(): string | undefined {
  const result = Bun.spawnSync(["who"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5_000 });
  return result.exitCode === 0 ? result.stdout.toString() : undefined;
}

export const realSeams = (): SshSeams => ({
  env: process.env,
  readFile: (path) => quietly(() => readFileSync(path, "latin1")),
  readLink: (path) => quietly(() => readlinkSync(path)),
  runWho: () => quietly(runWhoNow),
});

/** Detects on the first call and remembers the answer (also "none"): the operator's session does not change while pvx runs. */
export function lazySshClient(detect: () => SshClient | undefined = detectSshClient): () => string | undefined {
  let ip: string | undefined;
  let detected = false;
  return () => {
    if (!detected) {
      ip = detect()?.ip;
      detected = true;
    }
    return ip;
  };
}

/** The process-wide answer, shared by every context and by the audit. */
export const sshClient = lazySshClient();

/** `ctx.session` of the host: `sshClient` is read on demand, so a command that never asks never pays for `who`. */
export const hostSession: SessionInfo = {
  get sshClient() {
    return sshClient();
  },
};
