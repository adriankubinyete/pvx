import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Profile {
  id: string;
  title: string;
  when?: { file?: string };
  requires: string[];
}

/** Loads every `*.json` in dir, sorted by file name (selection order). Missing dir = no profiles. */
export async function loadProfiles(dir: string): Promise<Profile[]> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map((n) => Bun.file(join(dir, n)).json() as Promise<Profile>));
}

/** PVX_PROFILE forces one (unknown id throws); else first whose `when` holds; else null (caller shows a message). */
export function selectProfile(
  profiles: Profile[],
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean,
): Profile | null {
  const forced = env.PVX_PROFILE;
  if (forced) {
    const p = profiles.find((x) => x.id === forced);
    if (!p) throw new Error(`PVX_PROFILE="${forced}" desconhecido; perfis: ${profiles.map((x) => x.id).join(", ") || "(nenhum)"}`);
    return p;
  }
  return profiles.find((p) => !p.when?.file || fileExists(p.when.file)) ?? null;
}

/** The profile the TUI shows: like `selectProfile`, but a bad `PVX_PROFILE` or none at all gives null. */
export async function activeProfile(dir: string, env: Record<string, string | undefined>): Promise<Profile | null> {
  try {
    return selectProfile(await loadProfiles(dir), env, existsSync);
  } catch {
    return null;
  }
}
