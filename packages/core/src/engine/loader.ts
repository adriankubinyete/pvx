import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { BuiltinModule, Logger, Manifest, ModuleFactory, Sdk, SdkUi } from "@pvx/sdk";
import { readManifest } from "./manifest.ts";
import { createGranted, createReadCtx } from "./permissions.ts";
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

/** What a factory gets: the module's own logger and a `fs` bound to its manifest permissions. */
const sdkFor = (manifest: Manifest, opts: LoadOpts): Sdk => {
  const log = opts.makeLogger(manifest.id);
  return { version: 1, log, ui: opts.ui ?? unavailableUi, fs: createGranted(manifest.id, manifest.permissions, log, opts.makeLogger("core")).fs };
};

/** Scans usermodulesDir(). One module's failure is recorded in registry.errors and never stops the others. */
export async function loadModules(registry: Registry, opts: LoadOpts): Promise<void> {
  registry.readCtx = (id) => createReadCtx(id, registry.modules.get(id)?.permissions, opts.makeLogger, registry.query);
  for (const { manifest, factory } of opts.builtin ?? []) {
    try {
      registry.register(manifest, factory(sdkFor(manifest, opts)));
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
      await loadOne(registry, dir, opts);
    } catch (e) {
      registry.addError(id, (e as Error).message);
    }
  }
}

/** Evicts every cached file of the module so the next import re-evaluates it. Not `?v=`: that skips relative imports and leaks memory. */
export function evictModule(dir: string): void {
  const base = realpathSync(dir) + sep;
  for (const k of Object.keys(require.cache)) if (k.startsWith(base)) delete require.cache[k];
}

/** Manifest, gate, import, register. Throws on failure; a skipped module (`applies`, gate) returns quietly. `replace` swaps a registered module. */
export async function loadOne(registry: Registry, dir: string, opts: LoadOpts, replace = false): Promise<void> {
  const manifest = readManifest(dir, opts.hostVersion);
  if (!manifest) return;
  if (!(await (opts.canImport ?? (() => true))(dir, manifest))) return;
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
  registry.register(manifest, factory(sdkFor(manifest, opts)), { replace });
}
