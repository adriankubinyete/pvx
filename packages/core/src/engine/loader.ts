import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { BuiltinModule, Logger, Manifest, ModuleDef, ModuleFactory, Sdk, SdkUi } from "@pvx/sdk";
import { readManifest } from "./manifest.ts";
import { usermodulesDir } from "./paths.ts";
import type { Registry } from "./registry.ts";

/** Destructuring works (factories do it at load time); calling anything throws. */
const unavailableUi = new Proxy({}, {
  get: (_, k) =>
    typeof k === "string"
      ? () => {
          throw new Error("UI indisponível na CLI");
        }
      : undefined,
}) as SdkUi;

export interface LoadOpts {
  hostVersion: string;
  makeLogger: (name: string) => Logger;
  /** `sdk.ui` for the factories (the TUI package builds it; core has no React). Default: calls throw "UI indisponível". */
  ui?: SdkUi;
  /** Modules that ship with pvx (the app's static barrel): registered first, trusted, official. Not read from disk. */
  builtin?: readonly BuiltinModule[];
  /** Trust hook (`trustGate`). Default: allow everything. Returning false skips the module silently: its state comes from `listModules`, not from an error. */
  canImport?: (dir: string, manifest: Manifest) => boolean | Promise<boolean>;
}

/** Scans usermodulesDir(). One module's failure is recorded in registry.errors and never stops the others. */
export async function loadModules(registry: Registry, opts: LoadOpts): Promise<void> {
  for (const { manifest, factory } of opts.builtin ?? []) {
    try {
      registry.register(manifest, factory({ version: 1, log: opts.makeLogger(manifest.id), ui: opts.ui ?? unavailableUi }));
      registry.official.add(manifest.id);
    } catch (e) {
      registry.addError(manifest.id, (e as Error).message);
    }
  }
  const root = usermodulesDir();
  if (!existsSync(root)) return;
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id);
    if (id.startsWith(".") || !statSync(dir).isDirectory()) continue; // dot dirs: clones in progress
    try {
      const manifest = readManifest(dir, opts.hostVersion);
      if (!manifest) continue;
      if (!(await (opts.canImport ?? (() => true))(dir, manifest))) continue;
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
      const sdk: Sdk = { version: 1, log: opts.makeLogger(id), ui: opts.ui ?? unavailableUi };
      const def: ModuleDef = factory(sdk);
      registry.register(manifest, def);
    } catch (e) {
      registry.addError(id, (e as Error).message);
    }
  }
}
