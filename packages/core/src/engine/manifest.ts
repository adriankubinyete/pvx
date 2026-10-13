import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Manifest } from "@pvx/sdk";

/** Reads and shape-checks pvx-module.json without importing anything and without host checks (review uses it on fresh clones). */
export function readManifestRaw(dir: string): Manifest {
  let m: Manifest;
  try {
    m = JSON.parse(readFileSync(join(dir, "pvx-module.json"), "utf8"));
  } catch (e) {
    throw new Error(`manifest inválido: ${(e as Error).message}`);
  }
  const bad = (msg: string) => new Error(`manifest inválido: ${msg}`);
  if (!m || typeof m !== "object") throw bad("não é um objeto");
  for (const f of ["id", "version", "entry"] as const) {
    if (typeof m[f] !== "string" || !m[f]) throw bad(`campo "${f}" ausente`);
  }
  if (!/^[a-z0-9-]+$/.test(m.id)) throw bad(`id "${m.id}" deve ter só minúsculas, dígitos e hífen`);
  for (const f of ["os", "distro"] as const) {
    const v: unknown = m[f];
    if (v !== undefined && (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== "string" || !x.trim()))) {
      throw bad(`"${f}" deve ser uma lista não vazia de textos`);
    }
  }
  if (m.os?.some((x) => !["linux", "macos", "windows"].includes(x))) throw bad(`"os" aceita linux, macos, windows`);
  return m;
}

/** Reads and validates pvx-module.json. Throws a pt-BR Error; returns null when `applies` is not met (skip silently). */
export function readManifest(dir: string, hostVersion: string): Manifest | null {
  const m = readManifestRaw(dir);
  const bad = (msg: string) => new Error(`manifest inválido: ${msg}`);
  if (m.id !== basename(dir)) throw bad(`id "${m.id}" difere do diretório "${basename(dir)}"`);
  if (m.pvx !== undefined && !Bun.semver.satisfies(hostVersion, m.pvx)) {
    throw new Error(`requer pvx ${m.pvx} (instalado: ${hostVersion}); instale um pvx nessa faixa`);
  }
  if (m.applies?.file && !existsSync(m.applies.file)) return null;
  return m;
}
