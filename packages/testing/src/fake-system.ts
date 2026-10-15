// A fake machine for module tests: the seam that lets a command, a proof or a query run without touching the real system.
// `fakeCommandCtx` builds the same `ctx` a command gets (shell and phases included) over a fake exec, fs and store, so a test
// calls `command.run(ctx)` and reads what was printed, run and written. Nothing real runs and nothing real is written.
import type { AbortSignalLike, CommandCtx, ExecOpts, ExecResult, FsSpace, Logger, ModuleFs, ModuleNet, NetInit, NetResponse, NetUploadInit, OutLine, ReadCtx, Sdk, SessionInfo, Store } from "@pvx/sdk";
import { fakeFs, type FakeFs } from "./fake-fs.ts";
import { argGetters, cronKit, crontabKit, validateKit, createPhases, createReadShell, createShell, errorsKit, packagesKit, phasesKit, proofKit, strategyKit } from "@pvx/core";

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

/** One request a module made through `ctx.net`: `fetch` fills `init`, `upload` fills `upload`. */
export interface NetCall {
  url: string;
  init?: NetInit;
  upload?: NetUploadInit;
}
/** What a fake server answers; `body` is sent as text (an object as JSON). */
export interface NetReply {
  status: number;
  body?: unknown;
}
/** Answers a request, or returns undefined to let the next rule try. No rule answering means the network is down. */
export type NetRule = (call: NetCall) => NetReply | undefined;

export type FakeStore = Store & { data: Record<string, unknown> };

export interface FakeSystemOptions {
  rules?: Rule[];
  files?: Record<string, string>;
  store?: Record<string, unknown>;
  /** Answers `ctx.net.fetch` and `ctx.net.upload`, first match wins; with none, every request fails ("rede indisponível no teste"). */
  netRules?: NetRule[];
  /** What `fs.free` answers (default: roomy). A test moves `system.fs.space` later to fill the disk. */
  space?: Partial<FsSpace>;
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
  /** `ctx.net` over `netRules`; `netCalls` records every request. */
  net: ModuleNet;
  netCalls: NetCall[];
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
    return withBuffering(resultOf(reply), opts);
  };
  const fs = fakeFs(options.files, options.space);
  const netCalls: NetCall[] = [];
  return {
    exec,
    calls,
    fs,
    net: fakeNet(options.netRules ?? [], netCalls, fs),
    netCalls,
    store: memStore(options.store),
    session: { sshClient: options.sshClient },
    isRoot: options.isRoot ?? true,
    now: () => options.clock?.now ?? Date.now(),
    lines: () => calls.map(callLine),
    indexOf: (prefix) => calls.findIndex((call) => callLine(call).startsWith(prefix)),
  };
}

/** Like the real exec: `buffer: false` keeps `stdout` and `stderr` of the result empty (the lines already went to `onLine`). A probe that forgets `buffer: true` then fails here as it does on a machine. */
function withBuffering(result: ExecResult, opts: ExecOpts | undefined): ExecResult {
  if (opts?.buffer === false) return { ...result, stdout: "", stderr: "" };
  return result;
}

/** A reply that gave `lines` but no `stdout` still has the lines as stdout. */
function resultOf(reply: Reply): ExecResult {
  return { code: reply.code ?? 0, stdout: reply.stdout ?? (reply.lines ?? []).join("\n"), stderr: reply.stderr ?? "" };
}

const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function answerOf(reply: NetReply): NetResponse {
  const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
  return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, text: async () => text, json: async () => JSON.parse(text) };
}

function replyToRequest(rules: NetRule[], call: NetCall): NetResponse {
  for (const rule of rules) {
    const reply = rule(call);
    if (reply) return answerOf(reply);
  }
  throw new Error("rede indisponível no teste");
}

/** Like the real `upload`: the file must be there. Its bytes are never read: the test sees the call, not the multipart. */
async function requireFile(fs: ModuleFs, path: string): Promise<void> {
  const stat = await fs.stat(path);
  if (!stat || stat.isDir) throw new Error(`net: ${path} não é um arquivo que dê para enviar`);
}

function fakeNet(rules: NetRule[], calls: NetCall[], fs: ModuleFs): ModuleNet {
  return {
    async fetch(url, init) {
      const call: NetCall = { url, init };
      calls.push(call);
      return replyToRequest(rules, call);
    },
    async upload(url, upload) {
      await requireFile(fs, upload.file);
      const call: NetCall = { url, upload };
      calls.push(call);
      return replyToRequest(rules, call);
    },
  };
}
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
    net: system.net,
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
  return { version: 1, log: quietLog, ui: {} as Sdk["ui"], proof: proofKit, packages: packagesKit, strategy: strategyKit, errors: errorsKit, phases: phasesKit, cron: cronKit, crontab: crontabKit, validate: validateKit, fs };
}
