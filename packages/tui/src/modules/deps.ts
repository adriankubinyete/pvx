import { createContext, useContext, useEffect, useReducer, useSyncExternalStore } from "react";
import { listModules, loadCatalog, pendingUpdates, type Catalog, type LoadOpts, type ModuleRow, type Pending, type Registry } from "@pvx/core";

/** What the Módulos tab needs beyond the registry: how to load a module live, and the (injectable) slow lookups. */
export interface ModulesDeps {
  /** For `reconcileModule`: version, logger factory, `ui` and the trust gate. */
  load: LoadOpts;
  /** First words of core commands (an id equal to one is refused). */
  reserved?: string[];
  /** Tests only: accepts file:// URLs. */
  allowFile?: boolean;
  /** Default: `loadCatalog`. */
  catalog?: () => Promise<Catalog>;
  /** Default: `pendingUpdates`. */
  pending?: () => Promise<Pending[]>;
}

export const defaultCatalog = (d?: ModulesDeps) => (d?.catalog ?? loadCatalog)();
export const defaultPending = (d?: ModulesDeps) => (d?.pending ?? pendingUpdates)();

const Ctx = createContext<ModulesDeps | null>(null);
export const ModulesProvider = Ctx.Provider;
/** Null when the host gave none: the Módulos tab is then read-only. */
export const useModulesDeps = () => useContext(Ctx);

/** Re-renders when the registry changes; returns its revision. */
export const useRegistryRev = (r: Registry) => useSyncExternalStore(r.subscribe, () => r.rev);

/** Disk state of every module (git calls: async). Re-reads on a registry change or `reload()`. */
export function useModuleRows(registry: Registry): { rows: ModuleRow[]; reload: () => void } {
  const rev = useRegistryRev(registry);
  const [n, reload] = useReducer((x: number) => x + 1, 0);
  const [rows, setRows] = useReducer((_: ModuleRow[], r: ModuleRow[]) => r, []);
  useEffect(() => {
    let live = true;
    void listModules(registry).then((r) => live && setRows(r), () => {});
    return () => void (live = false);
  }, [registry, rev, n]);
  return { rows, reload };
}
