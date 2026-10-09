import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { Logger, Manifest, ModuleDef, ModuleFactory, Sdk } from "@pvx/sdk";
import { readManifest } from "./manifest.ts";
import { usermodulesDir } from "./paths.ts";
import type { Registry } from "./registry.ts";

export interface LoadOpts {
  hostVersion: string;
  makeLogger: (name: string) => Logger;
  /** Trust hook (Fase 4 plugs in here). Default: allow everything. Return false to refuse the import. */
  canImport?: (dir: string, manifest: Manifest) => boolean | Promise<boolean>;
}

/** Scans usermodulesDir(). One module's failure is recorded in registry.errors and never stops the others. */
export async function loadModules(registry: Registry, opts: LoadOpts): Promise<void> {
  const root = usermodulesDir();
  if (!existsSync(root)) return;
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id);
    if (!statSync(dir).isDirectory()) continue;
    try {
      const manifest = readManifest(dir, opts.hostVersion);
      if (!manifest) continue;
      if (!(await (opts.canImport ?? (() => true))(dir, manifest))) throw new Error("importação não permitida");
      const base = realpathSync(dir);
      let entry: string;
      try {
        entry = realpathSync(join(base, manifest.entry));
      } catch {
        throw new Error(`entry "${manifest.entry}" não encontrado`);
      }
      if (!entry.startsWith(base + sep)) throw new Error(`entry "${manifest.entry}" fora do diretório do módulo`);
      const factory = (await import(entry)).default as ModuleFactory | undefined;
      if (typeof factory !== "function") throw new Error("entry não exporta uma função por padrão (export default)");
      const sdk: Sdk = { version: 1, log: opts.makeLogger(id) };
      const def: ModuleDef = factory(sdk);
      registry.register(manifest, def);
    } catch (e) {
      registry.addError(id, (e as Error).message);
    }
  }
}
