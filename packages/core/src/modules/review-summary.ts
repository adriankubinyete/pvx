import { posix } from "node:path";
import type { Manifest } from "@pvx/sdk";
import { pvxHome } from "../engine/paths.ts";

/** Shells and privilege/sandbox escapes: whoever may run these may run anything. */
export const BROAD_EXEC = ["sh", "bash", "zsh", "dash", "ash", "ksh", "fish", "csh", "tcsh", "busybox", "sudo", "su", "doas", "pkexec", "systemd-run", "nsenter", "chroot", "env", "xargs"];

export interface PermissionSummary {
  /** Risky declarations as shown: `exec sh`, `rw /etc/systemd/system/`. */
  broad: string[];
  /** Exec and fs entries that are not in `broad`. */
  commonCount: number;
  /** The net list as declared. */
  net: string[];
}

export interface CommandSummary {
  total: number;
  /** Commands with a space ("ip list") grouped by first word, in declaration order. */
  groups: { name: string; count: number }[];
  singles: string[];
}

/** Expands `$PVX_HOME` and normalizes to forward slashes, so `..` cannot slip out of the module's own dir. */
const norm = (p: string, home: string) => posix.normalize(p.replaceAll("$PVX_HOME", home).replaceAll("\\", "/"));

/** Splits the declared exec/fs entries into broad and common; a `rw:` path outside `$PVX_HOME/modules/<id>/` is broad. */
export function summarizePermissions(id: string, perms: NonNullable<Manifest["permissions"]>): PermissionSummary {
  const home = pvxHome().replaceAll("\\", "/");
  const own = norm(`$PVX_HOME/modules/${id}`, home);
  const broad: string[] = [];
  let common = 0;
  for (const e of perms.exec ?? []) (BROAD_EXEC.includes(e.split("/").pop()!) ? broad.push(`exec ${e}`) : common++);
  for (const e of perms.fs ?? []) {
    if (!e.startsWith("rw:")) {
      common++;
      continue;
    }
    const p = norm(e.slice(3), home);
    if (p === own || p.startsWith(`${own}/`)) common++;
    else broad.push(`rw ${e.slice(3)}`);
  }
  return { broad, commonCount: common, net: perms.net ?? [] };
}

export function summarizeCommands(commands: string[] = []): CommandSummary {
  const groups = new Map<string, number>();
  const singles: string[] = [];
  for (const c of commands) {
    const i = c.indexOf(" ");
    if (i < 0) singles.push(c);
    else groups.set(c.slice(0, i), (groups.get(c.slice(0, i)) ?? 0) + 1);
  }
  return { total: commands.length, groups: [...groups].map(([name, count]) => ({ name, count })), singles };
}
