import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { CommandCtx, Logger, Manifest, PhasesState, QueryFn, ReadCtx, SessionInfo, WriteOpts } from "@pvx/sdk";
import { hostIsRoot } from "../host/root.ts";
import { hostSession } from "../host/ssh.ts";
import { PermissionDenied } from "./errors.ts";
import { phasesKey } from "./phases.ts";
import { moduleStateDir, profiledDir, pvxHome } from "./paths.ts";
import { runProgram } from "./exec.ts";
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

/**
 * `ctx.exec`, `ctx.net`, `ctx.fs`: they refuse anything the manifest did not list. NOT a sandbox: the module runs in this
 * process and can still call Bun.spawn itself. A violation throws and is logged to the module log and to core.log.
 */
export function createGranted(id: string, perms: Perms | undefined, log: Logger, coreLog: Logger): Granted {
  const deny = (what: string): never => {
    const m = `permissão negada para o módulo "${id}": ${what}`;
    for (const l of [log, coreLog]) {
      try {
        l.error(m);
      } catch {}
    }
    throw new PermissionDenied(m);
  };
  const fsRules = () => [
    { prefix: real(moduleStateDir(id)), write: true },
    ...(perms?.fs ?? []).map((e) => ({ prefix: real(expand(e.replace(/^rw:/, ""))), write: e.startsWith("rw:") })),
  ];
  const path = (p: string, write: boolean) => {
    const r = real(expand(p));
    if (!fsRules().some((x) => inside(r, x.prefix) && (x.write || !write))) deny(`fs ${write ? "escrita" : "leitura"} em ${p} (manifest: fs ${perms?.fs?.join(", ") || "nada"})`);
    return r;
  };
  return {
    async exec(cmd, args = [], o = {}) {
      if (!perms?.exec?.includes(basename(cmd))) deny(`exec ${cmd} (manifest: exec ${perms?.exec?.join(", ") || "nada"})`);
      return runProgram(cmd, args, o);
    },
    net: {
      fetch(url, init) {
        let u: URL;
        try {
          u = new URL(url);
        } catch {
          return deny(`URL inválida ${url}`);
        }
        if (!/^https?:$/.test(u.protocol) || !perms?.net?.includes(u.host)) deny(`net ${u.host} (manifest: net ${perms?.net?.join(", ") || "nada"})`);
        // Redirects could leave the allowed host: never followed.
        return fetch(u, { ...init, redirect: "manual" });
      },
    },
    fs: {
      read: (p) => Bun.file(path(p, false)).text(),
      async write(p, data, opts) {
        const r = path(p, true);
        mkdirSync(dirname(r), { recursive: true });
        writeFileWithOptions(r, data, opts ?? {});
      },
      exists: async (p) => existsSync(path(p, false)),
      list: async (p) => readdirSync(path(p, false)).sort(),
      remove: async (p) => rmSync(path(p, true), { force: true }),
      async append(p, text) {
        const r = path(p, true);
        mkdirSync(dirname(r), { recursive: true });
        const fd = openSync(r, "a", 0o644); // O_APPEND: the kernel places each write at the end, so lines from two processes never mix
        try {
          writeSync(fd, text); // one call: the whole event or nothing
        } finally {
          closeSync(fd);
        }
      },
    },
  };
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
    fs: { read: g.fs.read, exists: g.fs.exists, list: g.fs.list },
    jobs: (({ status, list, log }) => ({ status, list, log }))(createJobs(id)),
    phases: { state: (name) => createStore(id).get<PhasesState>(phasesKey(name)) },
  };
}
