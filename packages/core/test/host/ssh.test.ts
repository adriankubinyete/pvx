import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Logger } from "@pvx/sdk";
import { auditFile, createReadCtx, createRegistry, detectSshClient, execute, lazySshClient, type SshSeams } from "../../src/index.ts";

const noop = () => {};
const makeLogger = (): Logger => ({ debug: noop, info: noop, warn: noop, error: noop });

const SHELL_PID = 400;
const SUDO_PID = 500;
const OPERATOR_IP = "203.0.113.9";

const statusOf = (parent: number) => `Name:\tx\nPid:\t1\nPPid:\t${parent}\nUid:\t0\n`;
const environOf = (entries: Record<string, string>) => Object.entries(entries).map(([name, value]) => `${name}=${value}`).join("\0") + "\0";

interface FakeMachine {
  env?: Record<string, string>;
  /** Files by path; a missing path is unreadable. */
  files?: Record<string, string>;
  links?: Record<string, string>;
  who?: string;
}

/** A machine with no SSH trace at all, unless the test adds one. `reads` records every file the detection touched. */
function fakeSeams(machine: FakeMachine = {}): SshSeams & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    env: machine.env ?? {},
    readFile(path) {
      reads.push(path);
      return machine.files?.[path];
    },
    readLink: (path) => machine.links?.[path],
    runWho: () => machine.who,
  };
}

/** pvx -> sudo (500) -> login shell (400) -> sshd-less pid 1, with the SSH variables only in the shell, as after `sudo pvx`. */
function sudoChain(shellEnviron: Record<string, string>): Record<string, string> {
  return {
    [`/proc/${process.pid}/status`]: statusOf(SUDO_PID),
    [`/proc/${SUDO_PID}/status`]: statusOf(SHELL_PID),
    [`/proc/${SUDO_PID}/environ`]: environOf({ HOME: "/root", USER: "root" }),
    [`/proc/${SHELL_PID}/status`]: statusOf(1),
    [`/proc/${SHELL_PID}/environ`]: environOf(shellEnviron),
    "/proc/1/environ": environOf({ SSH_CONNECTION: "198.51.100.1 1 2 3" }),
  };
}

const WHO_OUTPUT = [
  "ana      pts/1        2026-10-14 08:00 (198.51.100.7)",
  "root     pts/3        2026-10-14 09:30 (203.0.113.9)",
  "bia      tty1         2026-10-14 07:00",
].join("\n");

describe("detectSshClient: environment", () => {
  test("SSH_CLIENT answers first, with the client address as first word", () => {
    const found = detectSshClient(fakeSeams({ env: { SSH_CLIENT: `${OPERATOR_IP} 51000 22` } }));
    expect(found).toEqual({ ip: OPERATOR_IP, source: "env" });
  });

  test("SSH_CONNECTION carries an IPv6 client", () => {
    const found = detectSshClient(fakeSeams({ env: { SSH_CONNECTION: "2001:db8::10 51000 2001:db8::1 22" } }));
    expect(found).toEqual({ ip: "2001:db8::10", source: "env" });
  });

  test("a value that is not an IP is skipped and the next attempt runs", () => {
    const seams = fakeSeams({ env: { SSH_CLIENT: "not-an-ip 1 22", SSH_CONNECTION: "999.1.1.1 1 2 3" }, files: sudoChain({ SSH_CONNECTION: `${OPERATOR_IP} 1 2 3` }) });
    expect(detectSshClient(seams)?.source).toBe("ancestor");
  });

  test("the environment wins over an ancestor and over who", () => {
    const seams = fakeSeams({
      env: { SSH_CLIENT: "192.0.2.5 1 22" },
      files: sudoChain({ SSH_CONNECTION: `${OPERATOR_IP} 1 2 3` }),
      links: { "/proc/self/fd/0": "/dev/pts/3" },
      who: WHO_OUTPUT,
    });
    expect(detectSshClient(seams)).toEqual({ ip: "192.0.2.5", source: "env" });
  });
});

describe("detectSshClient: ancestors (sudo wiped the environment)", () => {
  test("finds SSH_CONNECTION in the login shell above sudo", () => {
    const seams = fakeSeams({ files: sudoChain({ SSH_CONNECTION: `${OPERATOR_IP} 51000 10.0.0.2 22`, TERM: "xterm" }) });
    expect(detectSshClient(seams)).toEqual({ ip: OPERATOR_IP, source: "ancestor" });
  });

  test("falls back to SSH_CLIENT in an ancestor, IPv6 included", () => {
    const seams = fakeSeams({ files: sudoChain({ SSH_CLIENT: "2001:db8::77 51000 22" }) });
    expect(detectSshClient(seams)).toEqual({ ip: "2001:db8::77", source: "ancestor" });
  });

  test("stops at pid 1 without reading its environment", () => {
    const seams = fakeSeams({ files: sudoChain({ HOME: "/root" }) });
    expect(detectSshClient(seams)).toBeUndefined();
    expect(seams.reads).not.toContain("/proc/1/environ");
  });

  test("an unreadable ancestor environment is skipped quietly and the walk goes on", () => {
    const files = sudoChain({ SSH_CONNECTION: `${OPERATOR_IP} 1 2 3` });
    delete files[`/proc/${SUDO_PID}/environ`];
    expect(detectSshClient(fakeSeams({ files }))?.ip).toBe(OPERATOR_IP);
  });

  test("a status that loops back on itself ends the walk instead of hanging", () => {
    const files = { [`/proc/${process.pid}/status`]: statusOf(SUDO_PID), [`/proc/${SUDO_PID}/status`]: statusOf(SUDO_PID) };
    expect(detectSshClient(fakeSeams({ files }))).toBeUndefined();
  });
});

describe("detectSshClient: who and the terminal", () => {
  test("matches the line of the terminal of pvx and takes its (ip)", () => {
    const seams = fakeSeams({ links: { "/proc/self/fd/0": "/dev/pts/3" }, who: WHO_OUTPUT });
    expect(detectSshClient(seams)).toEqual({ ip: OPERATOR_IP, source: "who" });
  });

  test("when stdin is a pipe, the terminal comes from stdout", () => {
    const seams = fakeSeams({ links: { "/proc/self/fd/0": "pipe:[1234]", "/proc/self/fd/1": "/dev/pts/1" }, who: WHO_OUTPUT });
    expect(detectSshClient(seams)).toEqual({ ip: "198.51.100.7", source: "who" });
  });

  test("an IPv6 origin is accepted", () => {
    const who = "root     pts/3        2026-10-14 09:30 (2001:db8::10)";
    expect(detectSshClient(fakeSeams({ links: { "/proc/self/fd/0": "/dev/pts/3" }, who }))?.ip).toBe("2001:db8::10");
  });

  test("a local display or a tmux origin is not an IP", () => {
    const who = "root     pts/3        2026-10-14 09:30 (tmux(2211).%0)\nroot     pts/4        2026-10-14 09:30 (:0)";
    expect(detectSshClient(fakeSeams({ links: { "/proc/self/fd/0": "/dev/pts/3" }, who }))).toBeUndefined();
    expect(detectSshClient(fakeSeams({ links: { "/proc/self/fd/0": "/dev/pts/4" }, who }))).toBeUndefined();
  });

  test("a console login (no origin) and a terminal that who does not list give nothing", () => {
    expect(detectSshClient(fakeSeams({ links: { "/proc/self/fd/0": "/dev/tty1" }, who: WHO_OUTPUT }))).toBeUndefined();
    expect(detectSshClient(fakeSeams({ links: { "/proc/self/fd/0": "/dev/pts/9" }, who: WHO_OUTPUT }))).toBeUndefined();
  });

  test("pts/3 does not match pts/30", () => {
    const who = "root     pts/30       2026-10-14 09:30 (192.0.2.30)";
    expect(detectSshClient(fakeSeams({ links: { "/proc/self/fd/0": "/dev/pts/3" }, who }))).toBeUndefined();
  });

  test("an ancestor answer wins over who", () => {
    const seams = fakeSeams({ files: sudoChain({ SSH_CONNECTION: "192.0.2.77 1 2 3" }), links: { "/proc/self/fd/0": "/dev/pts/3" }, who: WHO_OUTPUT });
    expect(detectSshClient(seams)?.source).toBe("ancestor");
  });
});

describe("detectSshClient: nothing", () => {
  test("an empty machine gives undefined", () => {
    expect(detectSshClient(fakeSeams())).toBeUndefined();
  });

  test("an unreadable /proc and no terminal give undefined without throwing", () => {
    const seams = fakeSeams({ who: WHO_OUTPUT });
    expect(detectSshClient(seams)).toBeUndefined();
  });

  test("the real machine never throws, whatever the platform", () => {
    expect(() => detectSshClient()).not.toThrow();
  });
});

describe("lazySshClient", () => {
  test("detects on the first read only, and remembers a negative answer too", () => {
    let calls = 0;
    const lazy = lazySshClient(() => {
      calls++;
      return undefined;
    });
    expect(calls).toBe(0);
    expect(lazy()).toBeUndefined();
    expect(lazy()).toBeUndefined();
    expect(calls).toBe(1);
  });

  test("returns the ip of the answer", () => {
    expect(lazySshClient(() => ({ ip: OPERATOR_IP, source: "env" }))()).toBe(OPERATOR_IP);
  });
});

describe("ctx.session and audit", () => {
  const build = () => {
    const registry = createRegistry();
    registry.register(
      { id: "t", version: "1", entry: "x" },
      {
        commands: {
          who: { help: "h", destructive: true, run: (ctx) => ctx.out.info(String(ctx.session.sshClient)) },
        },
      },
    );
    return registry;
  };

  test("a command sees the session it was run with, and the audit records it as from", async () => {
    const result = await execute(build(), "t who", { makeLogger, confirmed: true, session: { sshClient: OPERATOR_IP } });
    expect(result.lines[0]?.text).toBe(OPERATOR_IP);
    const event = JSON.parse(readFileSync(auditFile(), "utf8").trim());
    expect(event).toMatchObject({ kind: "cmd", line: "t who", from: OPERATOR_IP });
  });

  test("a console login has no sshClient and the audit event has no from", async () => {
    const result = await execute(build(), "t who", { makeLogger, confirmed: true, session: { sshClient: undefined } });
    expect(result.lines[0]?.text).toBe("undefined");
    expect(JSON.parse(readFileSync(auditFile(), "utf8").trim())).not.toHaveProperty("from");
  });

  test("a read context carries the session too", async () => {
    const ctx = createReadCtx("t", undefined, makeLogger, build().query, { sshClient: OPERATOR_IP });
    expect(ctx.session.sshClient).toBe(OPERATOR_IP);
  });
});
