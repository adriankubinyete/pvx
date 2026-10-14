import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { CommandCtx, Logger, Manifest, NetInit, NetResponse, PhasesState, QueryFn, ReadCtx, SessionInfo, WriteOpts, AbortSignalLike } from "@pvx/sdk";
import { hostIsRoot } from "../host/root.ts";
import { hostSession } from "../host/ssh.ts";
import { PermissionDenied } from "./errors.ts";
import { phasesKey } from "./phases.ts";
import { moduleStateDir, profiledDir, pvxHome } from "./paths.ts";
import { runProgram } from "./exec.ts";
import { diskUsage, listEntries, makeDirectory, removePath, spaceOf, statOf } from "./fs-ops.ts";
import { DEFAULT_NET_TIMEOUT_MS, explainNetError, multipartBody, requestSignal, withoutFramingHeaders } from "./net.ts";
import { createJobs } from "./jobs.ts";
import { createReadShell } from "./shell.ts";
import { createStore } from "./store.ts";
import { strategyKit } from "./strategy.ts";

type Perms = NonNullable<Manifest["permissions"]>;
type Granted = Pick<CommandCtx, "exec" | "net" | "fs">;


/** `$PVX_HOME` (data dir) and `$PVX_PROFILED_DIR` (login hooks) in a manifest path; read when checked, so a test dir applies. */
const expand = (e: string) => e.replaceAll("$PVX_HOME", pvxHome()).replaceAll("$PVX_PROFILED_DIR", profiledDir());

/** realpath of the nearest existing ancestor + the rest: a symlink cannot walk a path out of its prefix. */
function real(p: string): string {
  const abs = resolve(p);
  const tail: string[] = [];
  let cur = abs;
  while (!existsSync(cur) && dirname(cur) !== cur) (tail.unshift(basename(cur)), (cur = dirname(cur)));
  try {
    return join(realpathSync(cur), ...tail);
  } catch {
    return abs;
  }
}
const inside = (p: string, prefix: string) => p === prefix || p.startsWith(prefix.endsWith(sep) ? prefix : prefix + sep);

/** Creates `file` empty and locked to `mode` before any content goes in (a plain write keeps the mode of a file that exists, and `writeFile` obeys the umask). */
function createWithMode(file: string, mode: number): void {
  writeFileSync(file, "", { mode });
  chmodSync(file, mode);
}

/** Plain write, a write that never shows wider bits than `mode`, and/or one that appears whole by a rename (temp file in the same directory). */
function writeFileWithOptions(file: string, data: string, { mode, atomic }: WriteOpts): void {
  const target = atomic ? `${file}.${process.pid}.tmp` : file;
  try {
    if (mode !== undefined) createWithMode(target, mode);
    writeFileSync(target, data);
    if (atomic) renameSync(target, file);
  } catch (error) {
    if (atomic) rmSync(target, { force: true });
    throw error;
  }
}

type Deny = (what: string) => never;
/** `path` resolves symlinks and checks the result; `entry` (for `remove`) resolves the folder of the entry, so a symlink is itself the thing deleted. */
interface FsGuard {
  path(path: string, write: boolean): string;
  entry(path: string): string;
}
type NetApi = CommandCtx["net"];
type FsApi = CommandCtx["fs"];

/** `host[:port]` of an http(s) URL in `permissions.net`, or a denial. Redirects are never followed, so the check holds for the whole request. */
function allowedUrl(url: string, perms: Perms | undefined, deny: Deny): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return deny(`URL inválida ${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol) || !perms?.net?.includes(parsed.host)) deny(`net ${parsed.host} (manifest: net ${perms?.net?.join(", ") || "nada"})`);
  return parsed;
}

/** The body of a plain request: text, bytes, or a file streamed from disk (a `Blob` that Bun reads lazily). */
function bodyOf(init: NetInit, readable: (path: string) => string): string | Uint8Array | ReturnType<typeof Bun.file> | undefined {
  if (init.body !== undefined && init.bodyFile !== undefined) throw new Error("net: passe body ou bodyFile, não os dois");
  if (init.bodyFile !== undefined) return Bun.file(readable(init.bodyFile));
  return init.body;
}

/** Sends the request under one signal (the caller's abort and the timeout); the headers go to the wire and nowhere else. */
async function send(url: URL, request: RequestInit, signal: AbortSignalLike | undefined, timeoutMs: number): Promise<NetResponse> {
  try {
    return await fetch(url, { ...request, redirect: "manual", signal: requestSignal(signal, timeoutMs) });
  } catch (error) {
    throw explainNetError(error, url.host, timeoutMs);
  }
}

function regularFileSize(path: string): number {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats?.isFile()) throw new Error(`net: ${path} não é um arquivo que dê para enviar`);
  return stats.size;
}

function createNet(perms: Perms | undefined, deny: Deny, guard: FsGuard): NetApi {
  const readable = (path: string) => guard.path(path, false);
  return {
    async fetch(url, init = {}) {
      const target = allowedUrl(url, perms, deny);
      const request = { method: init.method, headers: init.headers, body: bodyOf(init, readable) };
      return send(target, request, init.signal, init.timeoutMs ?? DEFAULT_NET_TIMEOUT_MS);
    },
    async upload(url, init) {
      const target = allowedUrl(url, perms, deny);
      const file = readable(init.file);
      const multipart = multipartBody({ path: file, size: regularFileSize(file), field: init.field ?? "file", filename: init.filename ?? basename(file), fields: init.fields ?? {} });
      const headers = { ...withoutFramingHeaders(init.headers), "content-type": multipart.contentType, "content-length": String(multipart.contentLength) };
      return send(target, { method: init.method ?? "POST", headers, body: multipart.stream }, init.signal, init.timeoutMs ?? DEFAULT_NET_TIMEOUT_MS);
    },
  };
}

function createFs(guard: FsGuard): FsApi {
  const readable = (path: string) => guard.path(path, false);
  const writable = (path: string) => guard.path(path, true);
  return {
    read: (path) => Bun.file(readable(path)).text(),
    async write(path, data, opts) {
      const resolved = writable(path);
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileWithOptions(resolved, data, opts ?? {});
    },
    exists: async (path) => existsSync(readable(path)),
    list: async (path) => readdirSync(readable(path)).sort(),
    entries: async (path) => listEntries(readable(path)),
    stat: async (path) => statOf(readable(path)),
    du: async (path) => diskUsage(readable(path)),
    free: async (path) => spaceOf(readable(path)),
    async mkdir(path, opts) {
      makeDirectory(writable(path), opts?.mode);
    },
    async remove(path, opts) {
      removePath(guard.entry(path), opts?.recursive ?? false);
    },
    async append(path, text) {
      const resolved = writable(path);
      mkdirSync(dirname(resolved), { recursive: true });
      const fd = openSync(resolved, "a", 0o644); // O_APPEND: the kernel places each write at the end, so lines from two processes never mix
      try {
        writeSync(fd, text); // one call: the whole event or nothing
      } finally {
        closeSync(fd);
      }
    },
  };
}

/**
 * `ctx.exec`, `ctx.net`, `ctx.fs`: they refuse anything the manifest did not list. NOT a sandbox: the module runs in this
 * process and can still call Bun.spawn itself. A violation throws and is logged to the module log and to core.log.
 */
export function createGranted(id: string, perms: Perms | undefined, log: Logger, coreLog: Logger): Granted {
  const deny: Deny = (what) => {
    const message = `permissão negada para o módulo "${id}": ${what}`;
    for (const logger of [log, coreLog]) {
      try {
        logger.error(message);
      } catch {}
    }
    throw new PermissionDenied(message);
  };
  const fsRules = () => [
    { prefix: real(moduleStateDir(id)), write: true },
    ...(perms?.fs ?? []).map((entry) => ({ prefix: real(expand(entry.replace(/^rw:/, ""))), write: entry.startsWith("rw:") })),
  ];
  const allow = (resolved: string, shown: string, write: boolean): string => {
    if (!fsRules().some((rule) => inside(resolved, rule.prefix) && (rule.write || !write))) deny(`fs ${write ? "escrita" : "leitura"} em ${shown} (manifest: fs ${perms?.fs?.join(", ") || "nada"})`);
    return resolved;
  };
  const guard: FsGuard = {
    path: (path, write) => allow(real(expand(path)), path, write),
    entry(path) {
      const expanded = resolve(expand(path));
      return allow(join(real(dirname(expanded)), basename(expanded)), path, true);
    },
  };
  return {
    async exec(cmd, args = [], opts = {}) {
      if (!perms?.exec?.includes(basename(cmd))) deny(`exec ${cmd} (manifest: exec ${perms?.exec?.join(", ") || "nada"})`);
      return runProgram(cmd, args, opts);
    },
    net: createNet(perms, deny, guard),
    fs: createFs(guard),
  };
}

/** The reads of `ctx.fs` and nothing else: the writers do not exist on the read-only context. */
function readOnlyFs(fs: FsApi): ReadCtx["fs"] {
  return { read: fs.read, exists: fs.exists, list: fs.list, entries: fs.entries, stat: fs.stat, du: fs.du, free: fs.free };
}

/** The read-only context of `prove`, queries and widgets: no `store.set`, no `fs` writes (they do not exist, not just refuse); `exec` is the same allowlist, logged. */
export function createReadCtx(id: string, perms: Perms | undefined, makeLogger: (name: string) => Logger, query: QueryFn, session: SessionInfo = hostSession, isRoot: boolean = hostIsRoot()): ReadCtx {
  const log = makeLogger(id);
  const g = createGranted(id, perms, log, makeLogger("core"));
  const exec: ReadCtx["exec"] = (cmd, args, o) => {
    log.info(`exec ${[cmd, ...(args ?? [])].join(" ")}`);
    return g.exec(cmd, args, o);
  };
  return {
    log,
    query,
    session,
    isRoot,
    store: { get: createStore(id).get },
    exec,
    shell: createReadShell(exec),
    strategy: strategyKit,
    fs: readOnlyFs(g.fs),
    jobs: (({ status, list, log }) => ({ status, list, log }))(createJobs(id)),
    phases: { state: (name) => createStore(id).get<PhasesState>(phasesKey(name)) },
  };
}
