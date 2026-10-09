import { join } from "node:path";
import { pvxHome } from "../engine/paths.ts";
import { readJson, writeJsonAtomic } from "../modules/trust.ts";

const seenFile = (user: string) => join(pvxHome(), "seen", `${user.replace(/[^\w.-]/g, "_")}.json`);

/** When this user last looked (ms). The notas module writes the same `{at}` file. */
export function lastSeen(user: string): number | undefined {
  const at = readJson<{ at?: string | number }>(seenFile(user), {}).at;
  const t = typeof at === "number" ? at : Date.parse(String(at));
  return Number.isNaN(t) ? undefined : t;
}

/** Best effort: a user without write access to PVX_HOME just keeps the old marker. */
export function markSeen(user: string, now = Date.now()): void {
  try {
    writeJsonAtomic(seenFile(user), { at: new Date(now).toISOString() });
  } catch {}
}
