import type { ArgSpec } from "@pvx/sdk";
import type { Registry, RegisteredCommand } from "@pvx/core";
import { clean } from "../palette/search.ts";

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
  /** A module that ships with pvx (◆). */
  official?: boolean;
  errorOf?: string;
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

/** The root menu, generated from the registry: modules (sorted; failed ones open their log). */
export function buildRoot(registry: Registry): Item[] {
  const failed = new Map(registry.errors.map((e) => [e.id, e.error]));
  const ids = [...new Set([...registry.modules.keys(), ...failed.keys()])].sort();
  const modules = ids.map((id): Item => {
    if (failed.has(id)) return { id: `m:${id}`, label: id, help: clean(failed.get(id)!), errorOf: id };
    const entries = [...registry.commands]
      .filter(([, cmd]) => cmd.moduleId === id)
      .map(([key, cmd]) => ({ key, cmd, path: key.split(" ").slice(1).filter(Boolean) }));
    return { id: `m:${id}`, label: id, official: registry.official.has(id), help: `${registry.modules.get(id)?.version ?? ""} carregado · ${plural(entries.length)}`, children: group(id, entries, 0) };
  });
  return modules;
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
