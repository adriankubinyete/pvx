import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync, watch, type FSWatcher } from "node:fs";
import { basename, join } from "node:path";
import { evictModule, loadOne, type LoadOpts } from "../engine/loader.ts";
import { readManifestRaw } from "../engine/manifest.ts";
import { usermodulesDir } from "../engine/paths.ts";
import type { Registry } from "../engine/registry.ts";
import { audit, devLinks, isRegisteredDev, msg, setDevLinks, type Result } from "./common.ts";

export interface LinkOpts {
  registry?: Registry;
  /** First words of core commands: a module id equal to one would be shadowed. */
  reserved?: string[];
}

/** Symlink usermodules/<manifest id> -> folder, recorded as dev in modules.json. No per-commit trust: the result says so. */
export function linkModule(path: string, o: LinkOpts = {}): Result & { id?: string } {
  try {
    const target = realpathSync(path);
    if (!statSync(target).isDirectory()) throw new Error(`${path} não é um diretório`);
    const { id } = readManifestRaw(target);
    const link = join(usermodulesDir(), id);
    const linked = (() => {
      try {
        return lstatSync(link).isSymbolicLink() && realpathSync(link) === target && isRegisteredDev(link, id);
      } catch {
        return false;
      }
    })();
    if (linked) return { ok: true, id, text: `${id}: já linkado` };
    if (o.reserved?.includes(id)) throw new Error(`id "${id}" é comando do núcleo`);
    if (o.registry?.modules.has(id) || existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) throw new Error(`id "${id}" já pertence a um módulo instalado`);
    mkdirSync(usermodulesDir(), { recursive: true });
    symlinkSync(target, link, "dir");
    setDevLinks([...devLinks().filter((d) => d.id !== id), { id, path: target }]);
    audit(`módulo linkado (dev): ${id} -> ${target}`);
    return { ok: true, id, text: `${id} linkado em modo dev: sem confiança por commit, o código é carregado como está` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Bun keeps a file whose import FAILED (syntax error, unresolved import) as errored for the rest of the process, even after
 * a fix and a cache eviction. So the graph is bundled in memory first: that reports those errors without poisoning anything.
 */
async function precheck(entry: string): Promise<void> {
  try {
    await Bun.build({ entrypoints: [entry], target: "bun", packages: "external" });
  } catch (e) {
    const errs = ((e as { errors?: { message?: string; position?: { file?: string; line?: number } | null }[] }).errors ?? []).slice(0, 3);
    throw new Error(errs.map((x) => `${x.message}${x.position ? ` (${basename(x.position.file ?? "")}:${x.position.line})` : ""}`).join("; ") || msg(e));
  }
}

/**
 * Re-imports a dev module and swaps it in the registry (commands, pages, widgets, capabilities). On any error the OLD version
 * stays registered. Caveats: there is no `dispose` hook yet, so timers and listeners the old version started keep running; and a
 * module that throws while being EVALUATED (top level, not in the factory) stays broken until pvx restarts (Bun keeps it errored).
 */
export async function reloadModule(registry: Registry, id: string, opts: LoadOpts): Promise<Result> {
  try {
    const dir = join(usermodulesDir(), id);
    if (!lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink() || !isRegisteredDev(dir, id)) throw new Error(`"${id}" não é um módulo dev registrado`);
    await precheck(join(realpathSync(dir), readManifestRaw(dir).entry));
    evictModule(dir);
    await loadOne(registry, dir, { ...opts, canImport: undefined }, true);
    registry.errors = registry.errors.filter((e) => e.id !== id);
    return { ok: true, text: `${id} recarregado` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export interface DevEvent {
  id: string;
  result: Result;
}
export interface WatchOpts extends LoadOpts {
  debounceMs?: number;
  /** Poll period when recursive `fs.watch` is unavailable, and the period at which new links are noticed. */
  pollMs?: number;
}

/** Changes under a folder, as a cheap signature (count + newest mtime), skipping `.git` and `node_modules`. */
function signature(dir: string): string {
  let n = 0;
  let newest = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else (n++, (newest = Math.max(newest, statSync(p).mtimeMs)));
    }
  };
  try {
    walk(dir);
  } catch {}
  return `${n}:${newest}`;
}

/** Watches every recorded dev link (picking up links made later) and reloads the module on save, debounced. Returns stop. */
export function watchDevModules(registry: Registry, onEvent: (e: DevEvent) => void, opts: WatchOpts): () => void {
  const { debounceMs = 150, pollMs = 500 } = opts;
  const watching = new Map<string, { path: string; stop: () => void }>();
  const reload = async (id: string) => onEvent({ id, result: await reloadModule(registry, id, opts) });

  function start(id: string, path: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => (clearTimeout(timer), (timer = setTimeout(() => void reload(id), debounceMs)));
    let w: FSWatcher | undefined;
    try {
      w = watch(path, { recursive: true }, (_, f) => {
        if (!/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(f ?? "")) bump();
      });
      w.on("error", () => {});
      watching.set(id, { path, stop: () => (clearTimeout(timer), w!.close()) });
    } catch {
      let sig = signature(path);
      const t = setInterval(() => {
        const s = signature(path);
        if (s !== sig) (sig = s), bump();
      }, pollMs);
      watching.set(id, { path, stop: () => (clearTimeout(timer), clearInterval(t)) });
    }
  }
  function sync() {
    const links = devLinks().filter((d) => existsSync(d.path));
    for (const [id, w] of watching) if (!links.some((d) => d.id === id && d.path === w.path)) (w.stop(), watching.delete(id));
    for (const d of links) if (!watching.has(d.id)) start(d.id, d.path);
  }
  sync();
  const t = setInterval(sync, Math.max(pollMs, 1000));
  return () => {
    clearInterval(t);
    for (const w of watching.values()) w.stop();
    watching.clear();
  };
}
