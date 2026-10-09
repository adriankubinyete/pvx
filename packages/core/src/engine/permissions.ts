import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { CommandCtx, Logger, Manifest } from "@pvx/sdk";
import { moduleStateDir } from "./paths.ts";

type Perms = NonNullable<Manifest["permissions"]>;
type Granted = Pick<CommandCtx, "exec" | "net" | "fs">;

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
    throw new Error(m);
  };
  const fsRules = [
    { prefix: real(moduleStateDir(id)), write: true },
    ...(perms?.fs ?? []).map((e) => ({ prefix: real(e.replace(/^rw:/, "")), write: e.startsWith("rw:") })),
  ];
  const path = (p: string, write: boolean) => {
    const r = real(p);
    if (!fsRules.some((x) => inside(r, x.prefix) && (x.write || !write))) deny(`fs ${write ? "escrita" : "leitura"} em ${p} (manifest: fs ${perms?.fs?.join(", ") || "nada"})`);
    return r;
  };
  return {
    async exec(cmd, args = [], o = {}) {
      if (!perms?.exec?.includes(basename(cmd))) deny(`exec ${cmd} (manifest: exec ${perms?.exec?.join(", ") || "nada"})`);
      const p = Bun.spawn([cmd, ...args], {
        cwd: o.cwd,
        env: { ...process.env, ...o.env },
        stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]),
        stdout: "pipe",
        stderr: "pipe",
        timeout: o.timeoutMs ?? 30_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(p.stdout as ReadableStream).text(), new Response(p.stderr as ReadableStream).text(), p.exited]);
      return { code, stdout, stderr };
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
      async write(p, data) {
        const r = path(p, true);
        mkdirSync(dirname(r), { recursive: true });
        await Bun.write(r, data);
      },
      exists: async (p) => existsSync(path(p, false)),
      list: async (p) => readdirSync(path(p, false)).sort(),
    },
  };
}
