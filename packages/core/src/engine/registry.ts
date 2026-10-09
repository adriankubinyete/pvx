import type { CapabilityDef, CommandDef, Manifest, ModuleDef, QueryFn } from "@pvx/sdk";

export interface LoadError {
  id: string;
  state: "error";
  error: string;
}
export type RegisteredCommand = CommandDef & { moduleId: string };

export interface Registry {
  /** Key = "<module> <path...>". */
  commands: Map<string, RegisteredCommand>;
  queries: Map<string, { moduleId: string; fn: QueryFn }>;
  capabilities: (CapabilityDef & { moduleId: string })[];
  modules: Map<string, Manifest>;
  errors: LoadError[];
  /** Refuses the whole module (nothing registered) on id, command or query conflict. */
  register(manifest: Manifest, def: ModuleDef): void;
  addError(id: string, error: string): void;
  query: QueryFn;
}

export function createRegistry(): Registry {
  const r: Registry = {
    commands: new Map(),
    queries: new Map(),
    capabilities: [],
    modules: new Map(),
    errors: [],
    register(manifest, def) {
      const id = manifest.id;
      if (r.modules.has(id)) throw new Error(`id "${id}" já registrado`);
      const cmds = Object.entries(def.commands ?? {}).map(([k, c]) => [`${id} ${k}`.trim(), c] as const);
      for (const [key] of cmds) {
        const other = r.commands.get(key);
        if (other) throw new Error(`conflito: comando "${key}" já pertence ao módulo "${other.moduleId}" (novo: "${id}")`);
      }
      for (const name of Object.keys(def.queries ?? {})) {
        const other = r.queries.get(name);
        if (other) throw new Error(`conflito: consulta "${name}" já pertence ao módulo "${other.moduleId}" (novo: "${id}")`);
      }
      r.modules.set(id, manifest);
      for (const [key, c] of cmds) r.commands.set(key, { ...c, moduleId: id });
      for (const [name, fn] of Object.entries(def.queries ?? {})) r.queries.set(name, { moduleId: id, fn });
      for (const c of def.capabilities ?? []) r.capabilities.push({ ...c, moduleId: id });
    },
    addError(id, error) {
      r.errors.push({ id, state: "error", error });
    },
    query(name, ...args) {
      const q = r.queries.get(name);
      if (!q) throw new Error(`consulta desconhecida: "${name}" (módulo ausente ou não expõe essa consulta)`);
      return q.fn(name, ...args);
    },
  };
  return r;
}
