// A fake machine for module tests: the seam that lets a command, a proof or a query run without touching the real system.
// `fakeCommandCtx` builds the same `ctx` a command gets (shell and phases included) over a fake exec, fs and store, so a test
// calls `command.run(ctx)` and reads what was printed, run and written. Nothing real runs and nothing real is written.
import type { AbortSignalLike, CommandCtx, ExecOpts, ExecResult, Logger, ModuleFs, OutLine, ReadCtx, Sdk, SessionInfo, Store } from "@pvx/sdk";
import { argGetters, createPhases, createReadShell, createShell, errorsKit, packagesKit, phasesKit, proofKit, strategyKit } from "@pvx/core";

export interface Call {
  cmd: string;
  args: string[];
  stdin?: string;
}
/** What a fake program answers; `lines` are streamed to `onLine` and also become `stdout`; `stderr` is streamed line by line as well. */
export interface Reply extends Partial<ExecResult> {
  lines?: string[];
}
/** Answers a call, or returns undefined to let the next rule try. */
export type Rule = (call: Call) => Reply | undefined;

export type FakeFs = ModuleFs & { files: Map<string, string>; modes: Map<string, number> };
export type FakeStore = Store & { data: Record<string, unknown> };

export interface FakeSystemOptions {
  rules?: Rule[];
  files?: Record<string, string>;
  store?: Record<string, unknown>;
  /** `ctx.session.sshClient` of the contexts built over this system. Default: none. */
  sshClient?: string;
  /** The time of the system: `phases` stamps with it, and a test moves it by changing `now`. Default: the real clock. */
  clock?: { now: number };
  /** `ctx.isRoot` of the contexts built over this system. Default: true (a fake machine is the one a module runs as root on). */
  isRoot?: boolean;
}

export interface FakeSystem {
  exec: CommandCtx["exec"];
  calls: Call[];
  fs: FakeFs;
  store: FakeStore;
  session: SessionInfo;
  isRoot: boolean;
  /** The time the system tells (`options.clock`, else the real clock). */
  now(): number;
  /** The calls as command lines, in order (`dnf install -y a b`). */
  lines(): string[];
  /** Index of the first call whose line starts with `prefix`, or -1. */
  indexOf(prefix: string): number;
}

export const callLine = (call: Call): string => `${call.cmd} ${call.args.join(" ")}`.trim();

export function fakeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map(Object.entries(initial));
  const modes = new Map<string, number>();
  return {
    files,
    modes,
    read: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`sem arquivo ${path}`);
      return text;
    },
    async write(path, data, opts) {
      files.set(path, data);
      if (opts?.mode !== undefined) modes.set(path, opts.mode);
    },
    exists: async (path) => files.has(path),
    list: async () => [],
    remove: async (path) => void files.delete(path),
    append: async (path, text) => void files.set(path, (files.get(path) ?? "") + text),
  };
}

export function memStore(initial: Record<string, unknown> = {}): FakeStore {
  const data: Record<string, unknown> = structuredClone(initial);
  return {
    data,
    get: <T>(key: string) => (data[key] === undefined ? undefined : (structuredClone(data[key]) as T)),
    set: (key, value) => void (data[key] = structuredClone(value)),
    update<T>(key: string, change: (current: T | undefined) => T): T {
      const next = change(data[key] === undefined ? undefined : (structuredClone(data[key]) as T));
      data[key] = structuredClone(next);
      return next;
    },
    delete: (key) => void delete data[key],
  };
}

/** The first rule that answers; no rule means exit 0 with no output. */
function replyTo(rules: Rule[], call: Call): Reply {
  for (const rule of rules) {
    const reply = rule(call);
    if (reply) return reply;
  }
  return {};
}

const LINE_BREAK = /\r\n|\r|\n/;

/** Like the real exec: stdout lines, then each non-empty line of `stderr`, reach `onLine` (and so the `shell` tail). */
function streamLines(reply: Reply, opts: ExecOpts | undefined): void {
  for (const line of reply.lines ?? []) opts?.onLine?.(line, "stdout");
  for (const line of (reply.stderr ?? "").split(LINE_BREAK)) {
    if (line) opts?.onLine?.(line, "stderr");
  }
}

export function fakeSystem(options: FakeSystemOptions = {}): FakeSystem {
  const calls: Call[] = [];
  const rules = options.rules ?? [];
  const exec: CommandCtx["exec"] = async (cmd, args = [], opts) => {
    const call: Call = { cmd, args, stdin: opts?.stdin };
    calls.push(call);
    const reply = replyTo(rules, call);
    streamLines(reply, opts);
    return resultOf(reply);
  };
  return {
    exec,
    calls,
    fs: fakeFs(options.files),
    store: memStore(options.store),
    session: { sshClient: options.sshClient },
    isRoot: options.isRoot ?? true,
    now: () => options.clock?.now ?? Date.now(),
    lines: () => calls.map(callLine),
    indexOf: (prefix) => calls.findIndex((call) => callLine(call).startsWith(prefix)),
  };
}

/** A reply that gave `lines` but no `stdout` still has the lines as stdout. */
function resultOf(reply: Reply): ExecResult {
  return { code: reply.code ?? 0, stdout: reply.stdout ?? (reply.lines ?? []).join("\n"), stderr: reply.stderr ?? "" };
}

const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const unavailableNet: CommandCtx["net"] = {
  fetch: async () => {
    throw new Error("rede indisponível no teste");
  },
};
const noJobs: CommandCtx["jobs"] = {
  start: async () => {},
  stop: async () => {},
  status: async () => ({ state: "none" }),
  list: async () => [],
  log: async () => [],
};

export type FakeCommandCtx = CommandCtx & { lines: OutLine[]; jobLines: string[] };

export interface FakeCommandOptions {
  /** Parsed args, as `ctx.args` has them. */
  args?: CommandCtx["args"];
  /** `ctx.signal`, which `shell.echoing` hands to every program. Default: one that never aborts. */
  signal?: AbortSignalLike;
}

/** What a command gets, over `system`. `lines` collects `ctx.out` and `jobLines` collects `ctx.jobLog`. */
export function fakeCommandCtx(system: FakeSystem, options: FakeCommandOptions = {}): FakeCommandCtx {
  const args = options.args ?? {};
  const lines: OutLine[] = [];
  const jobLines: string[] = [];
  const jobLog = (line: string) => void jobLines.push(line);
  const signal = options.signal ?? new AbortController().signal;
  const say = (kind: OutLine["kind"]) => (text: string) => void lines.push({ kind, text });
  const out = { success: say("success"), warning: say("warning"), error: say("error"), info: say("info"), plain: say("plain") };
  return {
    args,
    ...argGetters(args),
    out,
    log: quietLog,
    store: system.store,
    query: async () => undefined,
    session: system.session,
    slots: { read: () => undefined },
    exec: system.exec,
    shell: createShell(system.exec, { jobLog, signal }),
    strategy: strategyKit,
    isRoot: system.isRoot,
    signal,
    phases: createPhases(system.store, out, system.now),
    net: unavailableNet,
    fs: system.fs,
    jobs: noJobs,
    jobLog,
    lines,
    jobLines,
  };
}

/** What a proof, a query or a widget gets, over `system`. */
export function fakeReadCtx(system: FakeSystem): ReadCtx {
  return {
    log: quietLog,
    store: system.store,
    query: async () => undefined,
    session: system.session,
    exec: system.exec,
    shell: createReadShell(system.exec),
    strategy: strategyKit,
    isRoot: system.isRoot,
    fs: system.fs,
    jobs: noJobs,
    phases: createPhases(system.store, undefined, system.now),
  };
}

/** The `sdk` a factory receives when a test builds the module without the host. `ui` is empty: nothing here renders a page. */
export function fakeSdk(fs: ModuleFs = fakeFs()): Sdk {
  return { version: 1, log: quietLog, ui: {} as Sdk["ui"], proof: proofKit, packages: packagesKit, strategy: strategyKit, errors: errorsKit, phases: phasesKit, fs };
}
