import type { ArgSpec } from "@pvx/sdk";
import { commitLabel, type CatalogEntry, type ModuleRow, type ModuleState, type Pending, type Registry, type RegisteredCommand } from "@pvx/core";
import { clean } from "../palette/search.ts";

export type Tone = "ok" | "warn" | "error" | "info" | "dim";
/** A piece of a row's help line with its own color (the state, `↓n`, `✎n`). */
export interface Cell {
  text: string;
  tone?: Tone;
}

/** Where a module comes from: the mark after its id. */
export type Origin = "official" | "usermodule" | "dev" | "embedded";

/** One menu row. Exactly one of `children` (submenu), `line` (runs) or `errorOf` (opens a module's log) is set. */
export interface Item {
  /** Unique and stable: selection is by id, never by row index. */
  id: string;
  label: string;
  help: string;
  children?: Item[];
  /** Command line to run (a registry key). */
  line?: string;
  /** Args of the command: any of them opens the form. */
  args?: ArgSpec[];
  destructive?: boolean;
  /** Origin mark after the label (◆ official, ◇ usermodule, dev mark; an embedded module takes the dev mark). */
  origin?: Origin;
  /** `help` split in colored pieces; `help` is always their concatenation. */
  cells?: Cell[];
  errorOf?: string;
  /** Módulos root only: the module this row stands for, what the actions act on. */
  module?: { id: string; state: ModuleState; loaded: boolean; behind: number };
  /** A module page (`<module>.<name>`): enter opens it as a pushed screen. */
  page?: string;
  /** Catálogo rows only. */
  catalog?: CatalogEntry;
}

interface Entry {
  key: string;
  /** Command words after the module id. */
  path: string[];
  cmd: RegisteredCommand;
}

const byLabel = (a: Item, b: Item) => a.label.localeCompare(b.label);
const plural = (n: number) => `${n} ${n === 1 ? "comando" : "comandos"}`;

/** Groups entries by the word at `depth`: `ip accept`, `ip list`, `port deny` give submenus `ip` and `port`. */
function group(moduleId: string, entries: Entry[], depth: number): Item[] {
  const items: Item[] = [];
  const sub = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.path.length <= depth + 1) {
      items.push({
        id: `c:${e.key}`, label: e.path[depth] ?? moduleId, help: clean(e.cmd.help),
        line: e.key, args: e.cmd.args ?? [], destructive: Boolean(e.cmd.destructive),
      });
    } else sub.set(e.path[depth]!, [...(sub.get(e.path[depth]!) ?? []), e]);
  }
  for (const [word, es] of sub) {
    items.push({ id: `g:${moduleId} ${es[0]!.path.slice(0, depth + 1).join(" ")}`, label: word, help: plural(es.length), children: group(moduleId, es, depth + 1) });
  }
  return items.sort(byLabel);
}

export const STATE_TEXT: Record<ModuleState, string> = {
  carregado: "carregado", "aguardando-confianca": "aguardando confiança", desativado: "desativado", erro: "erro", modificado: "modificado", atras: "atrás", dev: "dev",
};
const STATE_TONE: Record<ModuleState, Tone> = { carregado: "ok", "aguardando-confianca": "warn", desativado: "dim", erro: "error", modificado: "warn", atras: "info", dev: "warn" };
const withHelp = (cells: Cell[]) => ({ cells, help: cells.map((c) => c.text).join("") });

const ORIGIN_RANK: [(registry: Registry, id: string, row?: ModuleRow) => boolean, Origin][] = [
  [(registry, id, row) => registry.official.has(id) || Boolean(row?.official), "official"],
  [(registry, id) => registry.embedded.has(id), "embedded"],
  [(_registry, _id, row) => row?.state === "dev", "dev"],
];

/** Where a module comes from: the first rule that holds, else an installed usermodule. */
function originOf(registry: Registry, id: string, row?: ModuleRow): Origin {
  const found = ORIGIN_RANK.find(([holds]) => holds(registry, id, row));
  return found ? found[1] : "usermodule";
}

/**
 * The Módulos root, from the registry plus what the disk and the update check know (`rows`, `pending`; both optional: the
 * first frame has only the registry). Loaded modules open their commands; the others have no children (the actions act on them).
 */
export function buildRoot(registry: Registry, rows: readonly ModuleRow[] = [], pending: readonly Pending[] = []): Item[] {
  const failed = new Map(registry.errors.map((e) => [e.id, e.error]));
  const ids = [...new Set([...registry.modules.keys(), ...failed.keys(), ...rows.map((r) => r.id)])].sort();
  return ids.map((id): Item => {
    const row = rows.find((r) => r.id === id);
    const loaded = registry.modules.has(id) && !failed.has(id);
    const behind = Math.max(row?.behind ?? 0, pending.find((p) => p.id === id)?.behind ?? 0);
    let state: ModuleState = failed.has(id) ? "erro" : row?.state ?? "carregado";
    if (loaded && state === "carregado" && behind) state = "atras";
    const origin = originOf(registry, id, row);
    const module = { id, state, loaded, behind };
    if (failed.has(id)) return { id: `m:${id}`, label: id, origin, module, ...withHelp([{ text: "erro: ", tone: "error" }, { text: clean(failed.get(id)!) }]), errorOf: id };
    const entries = [...registry.commands]
      .filter(([, cmd]) => cmd.moduleId === id)
      .map(([key, cmd]) => ({ key, cmd, path: key.split(" ").slice(1).filter(Boolean) }));
    const git = row?.ref && row.sha ? `${clean(row.ref)}@${row.sha.slice(0, 7)} ` : "";
    const cells: Cell[] = [
      ...(row?.embedded ? [{ text: `embutido (dev) ${commitLabel(row.embedded)} `, tone: "warn" as const }] : []),
      ...(git ? [{ text: git }] : []),
      ...(behind ? [{ text: `↓${behind} `, tone: "info" as const }] : []),
      ...(row?.dirty ? [{ text: `✎${row.dirty} `, tone: "warn" as const }] : []),
      ...(row?.incompatible ? [{ text: "⚠ sistema ", tone: "warn" as const }] : []),
      ...(row?.always ? [{ text: "∞ sempre ", tone: "info" as const }] : []),
      { text: `${registry.modules.get(id)?.version ?? row?.version ?? ""} ` },
      { text: STATE_TEXT[state], tone: STATE_TONE[state] },
      ...(loaded ? [{ text: ` · ${plural(entries.length)}` }] : row?.error ? [{ text: ` · ${clean(row.error)}` }] : []),
    ];
    const pages = [...registry.pages.values()].filter((p) => p.moduleId === id).map((p): Item => ({ id: `p:${p.key}`, label: clean(p.title), help: "página", page: p.key })).sort(byLabel);
    return { id: `m:${id}`, label: id, origin, module, ...withHelp(cells), ...(loaded ? { children: [...pages, ...group(id, entries, 0)] } : {}) };
  });
}

/** The Catálogo rows: what the catalog lists and is not installed. */
export function buildCatalog(entries: readonly CatalogEntry[]): Item[] {
  return entries.map((e) => ({ id: `k:${e.id}`, label: e.id, origin: "official" as const, catalog: e, help: clean(e.descricao) + (e.versao ? ` · ${clean(e.versao)}` : "") }));
}

/** The rows shown after following `path` (item ids) from the root; a stale id stops the walk. */
export function itemsAt(root: Item[], path: string[]): Item[] {
  let items = root;
  for (const id of path) items = items.find((i) => i.id === id)?.children ?? items;
  return items;
}

/** Labels along `path`, for the title. */
export function crumbs(root: Item[], path: string[]): string[] {
  const out: string[] = [];
  let items = root;
  for (const id of path) {
    const it = items.find((i) => i.id === id);
    if (!it) break;
    out.push(it.label);
    items = it.children ?? items;
  }
  return out;
}
