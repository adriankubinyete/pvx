import type { OutLine } from "@pvx/sdk";
import { reconcileModule, type Registry } from "@pvx/core";
import { clean } from "../palette/search.ts";
import type { ModulesDeps } from "./deps.ts";

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** What a loaded module delivers, for a success notice: ` · 19 comandos · aba Firewall disponível` (the tab only when it has one). */
export function deliveredTail(registry: Registry, id: string): string {
  const cmds = [...registry.commands.values()].filter((c) => c.moduleId === id).length;
  const tab = [...registry.pages.values()].find((p) => p.moduleId === id && p.tab);
  const label = tab && clean(tab.tab === true ? tab.title : tab.tab ? tab.tab.label : "");
  return ` · ${n(cmds, "comando", "comandos")}${label ? ` · aba ${label} disponível` : ""}`;
}

/** Re-reads one module from disk into the registry (no restart), then says what became of it. `what` is the verb for the success line. */
export async function reloadAndReport(registry: Registry, deps: ModulesDeps, id: string, what: string): Promise<{ exit: number; lines: OutLine[] }> {
  await reconcileModule(registry, id, deps.load);
  const err = registry.errors.find((e) => e.id === id);
  if (err) return { exit: 1, lines: [{ kind: "error", text: `${id} ${what}, mas não carregou: ${err.error}` }] };
  const m = registry.modules.get(id);
  if (!m) return { exit: 0, lines: [{ kind: "warning", text: `${id} ${what}, mas não está carregado (veja o estado em Módulos)` }] };
  const cmds = [...registry.commands.values()].filter((c) => c.moduleId === id).length;
  const pages = [...registry.pages.values()].filter((p) => p.moduleId === id).length;
  return { exit: 0, lines: [{ kind: "success", text: `${id} ${m.version} carregado · ${n(cmds, "comando", "comandos")}${pages ? ` · ${n(pages, "página", "páginas")}` : ""}` }] };
}
