import { lstatSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { auditModule } from "../journal/audit.ts";
import { logsDir, pvxHome } from "../engine/paths.ts";
import { createLogger } from "../logs/index.ts";
import { readJson, writeJsonAtomic } from "./trust.ts";

export type Result = { ok: true; text: string } | { ok: false; error: string };

const ID = /^[a-z0-9-]+$/;
export const validId = (id: string) => {
  if (!ID.test(id)) throw new Error(`id inválido: \`${id}\``);
  return id;
};
export const msg = (e: unknown) => (e as Error).message ?? String(e);
export const matchSha = (head: string, given: string) => given.length >= 7 && head.startsWith(given.toLowerCase());
export const isLink = (dir: string) => lstatSync(dir).isSymbolicLink();

/** The single call point for module audit: approve, revoke, remove, enable, disable, link, update go to core.log and to audit.jsonl (`module`). */
export function audit(m: string): void {
  try {
    createLogger(logsDir(), "core").info(m);
  } catch {}
  auditModule(m);
}

// ---- modules.json: `disabled` ids and the `dev` links (the only way a symlink loads)

export interface DevLink {
  id: string;
  /** realpath of the linked folder at link time. */
  path: string;
}
interface ModsFile {
  disabled?: string[];
  dev?: DevLink[];
}
const modulesFile = () => join(pvxHome(), "modules.json");
const readMods = () => readJson<ModsFile>(modulesFile(), {});
export const disabledSet = () => new Set(readMods().disabled ?? []);
export const writeDisabled = (s: Set<string>) => writeJsonAtomic(modulesFile(), { ...readMods(), disabled: [...s].sort() });
export const devLinks = (): DevLink[] => readMods().dev ?? [];
export const setDevLinks = (dev: DevLink[]) => writeJsonAtomic(modulesFile(), { ...readMods(), dev });

/** A symlink loads as dev only if `modules link` recorded it AND it still points where it was recorded. */
export function isRegisteredDev(dir: string, id: string): boolean {
  const rec = devLinks().find((d) => d.id === id);
  try {
    return Boolean(rec) && realpathSync(dir) === rec!.path;
  } catch {
    return false;
  }
}

// ---- update-notice cache

export const updateCheckFile = () => join(pvxHome(), "update-check.json");
/** Called on every add, update and remove: a stale cache would keep showing the old state. */
export const invalidateUpdateCache = () => rmSync(updateCheckFile(), { force: true });
