import type { CatalogEntry, ModuleRow, Registry } from "@pvx/core";
import { clean } from "../palette/search.ts";
import type { TabId } from "../tabs/context.ts";
import { tabOf } from "../tabs/pageTabs.ts";
import { STATE_TEXT, type Item, type Origin, type Tone } from "./tree.ts";

/** Columns of the card grid: 3 from 120 terminal columns, 2 from 80, else 1. */
export const gridCols = (cols: number) => (cols >= 120 ? 3 : cols >= 80 ? 2 : 1);
/** Total card height: border, name, what it delivers, a gap, the chips. */
export const CARD_H = 6;
export const CARD_GAP = 1;

export interface Chip {
  text: string;
  tone: Tone;
  /** Drawn as a solid chip (needs attention) instead of colored text. */
  solid?: boolean;
}

/** What a card stands for. Dashed cards have an action and no module. */
export type CardKind = "module" | "catalog" | "add" | "open";

export interface Card {
  /** Selection key: `m:<id>` (same as the drill-down rows), `k:<id>`, `act:add`, `act:catalog`. */
  id: string;
  kind: CardKind;
  name: string;
  origin?: Origin;
  /** Right of the first line: the state word with its tone (`dot`: ● or ○). */
  state?: { text: string; tone: Tone; dot: "●" | "○" };
  /** Second line (dim, or error-colored). */
  line2: { text: string; tone?: Tone };
  chips: Chip[];
  version?: string;
  /** Official card without chips: the bottom left reads `oficial`; the version is always on the right. */
  official?: boolean;
  /** Dashed cards: the key shown bold, the label and the sub line. */
  key?: string;
  sub?: string;
  module?: NonNullable<Item["module"]>;
  /** The module has a drill-down (commands and pages). */
  children?: boolean;
  catalog?: CatalogEntry;
  /** The tab this module contributes, whatever its visibility. */
  tab?: { id: TabId; label: string };
  tabHidden: boolean;
  widgets: boolean;
  widgetsHidden: boolean;
  /** The strip under the grid: `parts` of the first line, `warn` the second one. */
  detail: { parts: { text: string; tone?: Tone | "name" }[]; warn?: { text: string; tone: Tone } };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `owner/repo` of a git URL or path; the whole text when it has no such shape. */
export function repoOf(url: string): string {
  const parts = url.replace(/\.git$/, "").replace(/\/+$/, "").split(/[/:]/).filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : url;
}

const wantedOf = (text: string) => /^feito para (.+?); este sistema/.exec(text)?.[1] ?? "outro sistema";

const stateOf = (state: Item["module"] & {}, loaded: boolean): NonNullable<Card["state"]> => {
  const s = state.state;
  if (s === "erro") return { text: "erro", tone: "error", dot: "●" };
  if (s === "aguardando-confianca") return { text: "aguardando", tone: "warn", dot: "●" };
  if (s === "desativado") return { text: "desativado", tone: "dim", dot: "○" };
  if (s === "modificado") return { text: "modificado", tone: "warn", dot: "●" };
  if (s === "atras") return { text: `atrás ↓${state.behind}`, tone: "info", dot: "●" };
  return loaded ? { text: "carregado", tone: "ok", dot: "●" } : { text: STATE_TEXT[s], tone: "warn", dot: "●" };
};

/** One card per module of the Módulos root (`root` comes from `buildRoot`), with what the registry and the disk know. */
export function moduleCards(root: readonly Item[], registry: Registry, rows: readonly ModuleRow[], hiddenTabs: ReadonlySet<string>, hiddenWidgets: ReadonlySet<string>): Card[] {
  return root.map((item): Card => {
    const m = item.module!;
    const row = rows.find((r) => r.id === m.id);
    const origin = item.origin!;
    const official = origin === "official";
    const version = registry.modules.get(m.id)?.version ?? row?.version;
    const cmds = [...registry.commands.values()].filter((c) => c.moduleId === m.id).length;
    const own = [...registry.pages.values()].filter((p) => p.moduleId === m.id);
    const tab = tabOf(registry, m.id);
    const plainPages = own.filter((p) => !p.tab).length;
    const widgets = registry.slots.hasWidgets(m.id);
    const tabHidden = hiddenTabs.has(m.id);
    const widgetsHidden = hiddenWidgets.has(m.id);

    const delivered = [cmds ? plural(cmds, "comando", "comandos") : "", tab ? `aba ${tab.label}` : "", plainPages ? plural(plainPages, "página", "páginas") : ""].filter(Boolean).join(" · ");
    const errText = m.state === "erro" ? clean(row?.error ?? item.help.replace(/^erro: /, "")) : row?.error ? clean(row.error) : "";
    const line2: Card["line2"] = m.state === "erro" ? { text: errText, tone: "error" }
      : m.loaded ? { text: delivered || "nada a entregar" }
      : m.state === "aguardando-confianca" ? { text: errText || "nada foi importado ainda" }
      : { text: errText || "não carregado" };

    const chips: Chip[] = [];
    if (row?.incompatible) chips.push({ text: `⚠ só ${wantedOf(row.incompatible)}`, tone: "warn", solid: true });
    if (tab && tabHidden) chips.push({ text: "aba oculta", tone: "dim" });
    if (widgets && widgetsHidden) chips.push({ text: "widget oculto", tone: "dim" });

    const where = row?.url ? repoOf(row.url) : official ? "embutido no pvx" : "";
    const parts: Card["detail"]["parts"] = [{ text: m.id, tone: "name" }];
    if (where) parts.push({ text: ` · ${where}${row?.ref ? ` @ ${clean(row.ref)}` : ""}` });
    if (row?.sha) parts.push({ text: " · " }, { text: row.sha.slice(0, 7), tone: "info" });
    if (row?.url || row?.sha) parts.push(m.behind ? { text: ` · ↓${m.behind} ${m.behind === 1 ? "atualização" : "atualizações"}`, tone: "info" } : { text: " · em dia" });

    const warn: Card["detail"]["warn"] = row?.incompatible ? { text: `⚠ ${clean(row.incompatible)}`, tone: "warn" }
      : m.state === "erro" ? { text: `✗ ${errText}`, tone: "error" }
      : m.state === "aguardando-confianca" ? { text: "aguardando confiança: enter → revisar", tone: "warn" }
      : undefined;
    return {
      id: item.id, kind: "module", name: m.id, origin, state: stateOf(m, m.loaded), line2, chips, version, official,
      module: m, children: Boolean(item.children), tab, tabHidden, widgets, widgetsHidden, detail: { parts, warn },
    };
  });
}

/** The cards of the Catálogo view: what the catalog lists and is not installed. */
export function catalogCards(entries: readonly CatalogEntry[]): Card[] {
  return entries.map((e): Card => ({
    id: `k:${e.id}`, kind: "catalog", name: e.id, origin: "usermodule", line2: { text: clean(e.descricao) }, chips: [], version: e.versao && clean(e.versao),
    catalog: e, tabHidden: false, widgets: false, widgetsHidden: false,
    detail: { parts: [{ text: e.id, tone: "name" }, { text: ` · ${repoOf(e.url)}` }, { text: " · enter → instalar" }] },
  }));
}

/** The two dashed cards that close the installed grid. `available`: modules the catalog lists and are not installed; undefined while it is unknown. */
export function actionCards(available: number | undefined): Card[] {
  const base = { chips: [], tabHidden: false, widgets: false, widgetsHidden: false };
  const note = (text: string) => ({ parts: [{ text }] });
  return [
    { ...base, detail: note("clona o repositório e abre a revisão de confiança antes de importar"), id: "act:add", kind: "add", name: "adicionar por URL", key: "a", sub: "usuario/repo ou link git", line2: { text: "" } },
    { ...base, detail: note("módulos que o pvx indica e ainda não estão instalados"), id: "act:catalog", kind: "open", name: "abrir o catálogo", key: "c", sub: available === undefined ? "catálogo indisponível" : plural(available, "módulo disponível", "módulos disponíveis"), line2: { text: "" } },
  ];
}

export type ActionId = "open" | "children" | "log" | "tab" | "widgets" | "update" | "review" | "toggle" | "remove" | "install";
export interface CardAction {
  id: ActionId;
  label: string;
  /** Direct shortcut: works on the selected card without opening the menu. */
  key?: string;
  /** Current value of a toggle: ✓ on, — off. */
  state?: "✓" | "—";
}

/** What the action menu offers for a card: only what applies to it. */
export function cardActions(card: Card): CardAction[] {
  if (card.kind === "catalog") return [{ id: "install", label: "instalar", key: "i" }];
  const m = card.module;
  if (card.kind !== "module" || !m) return [];
  const out: CardAction[] = [];
  if (card.tab && !card.tabHidden) out.push({ id: "open", label: `abrir a aba ${card.tab.label}` });
  if (m.state === "erro") out.push({ id: "log", label: "ver o log", key: "l" });
  else if (card.children) out.push({ id: "children", label: "comandos e páginas", key: "l" });
  if (card.tab) out.push({ id: "tab", label: "mostrar a aba", key: "t", state: card.tabHidden ? "—" : "✓" });
  if (card.widgets) out.push({ id: "widgets", label: "widgets no Início", key: "w", state: card.widgetsHidden ? "—" : "✓" });
  if (!card.official) {
    if (m.state === "aguardando-confianca") out.push({ id: "review", label: "revisar", key: "r" });
    else out.push({ id: "update", label: "atualizar", key: "u" }, { id: "toggle", label: m.state === "desativado" ? "ativar" : "desativar", key: "d" });
    out.push({ id: "remove", label: "remover", key: "x" });
  }
  return out;
}
