import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Manifest } from "../../../sdk/src/index.ts";

/** Reads and validates pvx-module.json. Throws a pt-BR Error; returns null when `applies` is not met (skip silently). */
export function readManifest(dir: string, hostVersion: string): Manifest | null {
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
  if (m.id !== basename(dir)) throw bad(`id "${m.id}" difere do diretório "${basename(dir)}"`);
  if (m.pvx !== undefined && !Bun.semver.satisfies(hostVersion, m.pvx)) {
    throw new Error(`requer pvx ${m.pvx} (instalado: ${hostVersion}); instale um pvx nessa faixa`);
  }
  if (m.applies?.file && !existsSync(m.applies.file)) return null;
  return m;
}
