import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "@pvx/sdk";
import { pvxHome } from "../engine/paths.ts";

export interface TrustEntry {
  url: string;
  sha: string;
  approvedBy: string;
  at: string;
  permissions: Manifest["permissions"];
  /** Every future commit from this same origin applies without review. */
  always?: true;
}

const trustFile = () => join(pvxHome(), "trust.json");

/** Temp file then rename: a reader never sees a half-written file. */
export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export const listTrust = (): Record<string, TrustEntry> => readJson(trustFile(), {});
export const getTrust = (id: string): TrustEntry | undefined => listTrust()[id];

// note: read-modify-write without a lock; two simultaneous approvals can lose one. Atomic rename only prevents torn files.
export function approve(id: string, e: { url: string; sha: string; permissions?: Manifest["permissions"]; always?: boolean }): TrustEntry {
  const entry: TrustEntry = {
    url: e.url,
    sha: e.sha,
    approvedBy: process.env.SUDO_USER || process.env.LOGNAME || process.env.USER || "desconhecido",
    at: new Date().toISOString(),
    permissions: e.permissions ?? {},
    ...(e.always ? { always: true as const } : {}),
  };
  writeJsonAtomic(trustFile(), { ...listTrust(), [id]: entry });
  return entry;
}

export function revoke(id: string): boolean {
  const all = listTrust();
  if (!(id in all)) return false;
  delete all[id];
  writeJsonAtomic(trustFile(), all);
  return true;
}
