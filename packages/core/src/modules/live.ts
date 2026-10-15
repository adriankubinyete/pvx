import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { evictModule, loadOne, type LoadOpts } from "../engine/loader.ts";
import { usermodulesDir } from "../engine/paths.ts";
import type { Registry } from "../engine/registry.ts";
import { msg } from "./common.ts";
import * as G from "./git.ts";

/**
 * Brings the registry in line with the disk for one usermodule, no restart: drops what it contributed, then imports it again if
 * it is still there and `opts.canImport` (the trust gate) lets it in. Call it after trust, update, remove, enable and disable.
 * A failed import becomes a registry error. Built-ins and embedded modules are never touched.
 */
export async function reconcileModule(registry: Registry, id: string, opts: LoadOpts): Promise<void> {
  if (registry.official.has(id) || registry.embedded.has(id)) return;
  registry.unregister(id);
  const dir = join(usermodulesDir(), id);
  if (!existsSync(dir)) return;
  try {
    evictModule(dir); // an updated file must be evaluated again
    await loadOne(registry, dir, opts);
  } catch (e) {
    registry.addError(id, msg(e));
  }
  void registry.slots.refresh(); // the new widgets collect now, not at the next tick
}

/** Tracked files of a module checkout, for the "ver o código" step of the review. */
export async function listCode(dir: string): Promise<string[]> {
  return (await G.git(dir, ["ls-files"])).split("\n").filter(Boolean).sort();
}

const MAX_BYTES = 256 * 1024;

/** One file of the checkout as text (read-only). A path that resolves outside the checkout (a symlink in the repo) is refused. */
export function readCode(dir: string, rel: string): string {
  const base = realpathSync(dir) + sep;
  const real = realpathSync(join(dir, rel));
  if (!real.startsWith(base)) throw new Error(`${rel} aponta para fora do módulo`);
  if (statSync(real).size > MAX_BYTES) return `(arquivo com mais de ${MAX_BYTES / 1024} KB: não exibido)`;
  return readFileSync(real, "utf8");
}

/** What an update would change: `git diff HEAD <sha>` of the already-fetched commit. */
export const codeDiff = (dir: string, sha: string) => G.git(dir, ["diff", "--no-color", "HEAD", sha]);
