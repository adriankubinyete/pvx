import { createReadCtx } from "./permissions.ts";
import { createSlotHub, type SlotHub, type SlotOpts } from "./slots.ts";
import type { CapabilityDef, CommandDef, Manifest, ModuleDef, ModuleQuery, PageDef, QueryFn, ReadCtx, Roles } from "@pvx/sdk";

export interface LoadError {
  id: string;
  state: "error";
  error: string;
}
export type RegisteredCommand = CommandDef & { moduleId: string };
/** `key` = "<module>.<name>". */
export type RegisteredPage = PageDef & { key: string; moduleId: string; name: string };

export interface Registry {
  /** Key = "<module> <path...>". */
  commands: Map<string, RegisteredCommand>;
  queries: Map<string, { moduleId: string; fn: ModuleQuery }>;
  capabilities: (CapabilityDef & { moduleId: string })[];
  /** Key = "<module>.<name>". */
  pages: Map<string, RegisteredPage>;
  modules: Map<string, Manifest>;
  /** Ids of the modules that ship with pvx (marked ◆). */
  official: Set<string>;
  /** Role -> the query or command name that fills it (see `ModuleDef.roles`). */
  roles: Map<keyof Roles, { moduleId: string; name: string }>;
  /** Widgets of every module, collected per home slot. */
  slots: SlotHub;
  errors: LoadError[];
  /** Bumps on every change (register, unregister, error, `changed()`): the UI re-reads on it. */
  rev: number;
  subscribe(fn: () => void): () => void;
  /** For code that mutates the registry by hand (a dev reload clearing errors). */
  changed(): void;
  /** Drops everything a module contributed, plus its load errors: remove, disable, a trust that no longer holds. */
  unregister(id: string): void;
  /** Refuses the whole module (nothing registered) on id, command or query conflict. `replace` swaps an already registered module atomically (reload). */
  register(manifest: Manifest, def: ModuleDef, o?: { replace?: boolean }): void;
  addError(id: string, error: string): void;
  query: QueryFn;
  /** The read-only context a module's queries and widgets get. The loader replaces it with one that logs to the real loggers. */
  readCtx: (moduleId: string) => ReadCtx;
}

const noop = () => {};
const silent = { debug: noop, info: noop, warn: noop, error: noop };

export function createRegistry(opts: { slots?: SlotOpts } = {}): Registry {
  const subs = new Set<() => void>();
  const drop = (id: string) => {
    for (const [k, c] of r.commands) if (c.moduleId === id) r.commands.delete(k);
    for (const [k, q] of r.queries) if (q.moduleId === id) r.queries.delete(k);
    for (const [k, p] of r.pages) if (p.moduleId === id) r.pages.delete(k);
    for (const [k, v] of r.roles) if (v.moduleId === id) r.roles.delete(k);
    r.capabilities = r.capabilities.filter((c) => c.moduleId !== id);
    r.slots.remove(id);
  };
  const r: Registry = {
    commands: new Map(),
    queries: new Map(),
    capabilities: [],
    pages: new Map(),
    modules: new Map(),
    official: new Set(),
    roles: new Map(),
    slots: createSlotHub({ ...opts.slots, ctxFor: (id) => r.readCtx(id) }),
    errors: [],
    rev: 0,
    readCtx: (id) => createReadCtx(id, r.modules.get(id)?.permissions, () => silent, r.query),
    subscribe: (fn) => (subs.add(fn), () => void subs.delete(fn)),
    changed() {
      r.rev++;
      subs.forEach((f) => f());
    },
    unregister(id) {
      drop(id);
      r.modules.delete(id);
      r.official.delete(id);
      r.errors = r.errors.filter((e) => e.id !== id);
      r.changed();
    },
    register(manifest, def, o) {
      const id = manifest.id;
      if (r.modules.has(id) && !o?.replace) throw new Error(`id "${id}" já registrado`);
      const cmds = Object.entries(def.commands ?? {}).map(([k, c]) => [`${id} ${k}`.trim(), c] as const);
      for (const [key] of cmds) {
        const other = r.commands.get(key);
        if (other && other.moduleId !== id) throw new Error(`conflito: comando "${key}" já pertence ao módulo "${other.moduleId}" (novo: "${id}")`);
      }
      for (const name of Object.keys(def.queries ?? {})) {
        const other = r.queries.get(name);
        if (other && other.moduleId !== id) throw new Error(`conflito: consulta "${name}" já pertence ao módulo "${other.moduleId}" (novo: "${id}")`);
      }
      for (const k of Object.keys(def.roles ?? {}) as (keyof Roles)[]) {
        const other = r.roles.get(k);
        if (other && other.moduleId !== id) throw new Error(`conflito: papel "${k}" já pertence ao módulo "${other.moduleId}" (novo: "${id}")`);
      }
      if (r.modules.has(id)) drop(id);
      r.modules.set(id, manifest);
      for (const [key, c] of cmds) r.commands.set(key, { ...c, moduleId: id });
      for (const [name, fn] of Object.entries(def.queries ?? {})) r.queries.set(name, { moduleId: id, fn });
      for (const c of def.capabilities ?? []) r.capabilities.push({ ...c, moduleId: id });
      for (const [k, name] of Object.entries(def.roles ?? {})) if (name) r.roles.set(k as keyof Roles, { moduleId: id, name });
      for (const [name, w] of Object.entries(def.widgets ?? {})) r.slots.add(id, name, w);
      for (const [name, p] of Object.entries(def.pages ?? {})) r.pages.set(`${id}.${name}`, { ...p, key: `${id}.${name}`, moduleId: id, name });
      r.changed();
    },
    addError(id, error) {
      r.errors.push({ id, state: "error", error });
      r.changed();
    },
    query(name, ...args) {
      const q = r.queries.get(name);
      if (!q) throw new Error(`consulta desconhecida: "${name}" (módulo ausente ou não expõe essa consulta)`);
      return q.fn.call(r.readCtx(q.moduleId), name, ...args);
    },
  };
  return r;
}

/** Longest-prefix command lookup: `n` is how many argv words form the command path. */
export function resolveCommand(registry: Registry, argv: string[]) {
  for (let n = argv.length; n > 0; n--) {
    const key = argv.slice(0, n).join(" ");
    const cmd = registry.commands.get(key);
    if (cmd) return { key, cmd, n };
  }
  return undefined;
}

/** `#<module>.<name>` exactly, or `<name>` when only one module has a page of that name. */
export function resolvePage(registry: Registry, ref: string): RegisteredPage | undefined {
  const exact = registry.pages.get(ref);
  if (exact) return exact;
  const named = [...registry.pages.values()].filter((p) => p.name === ref);
  return named.length === 1 ? named[0] : undefined;
}

/** The page a module declared with this role (`PageDef.role`): how the host reaches a page without naming its module. */
export const pageWithRole = (registry: Pick<Registry, "pages">, role: NonNullable<PageDef["role"]>): RegisteredPage | undefined =>
  [...registry.pages.values()].find((p) => p.role === role);
