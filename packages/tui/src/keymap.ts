import type { KeyEvent } from "@opentui/core";
import { paletteShortcuts } from "./palette/shortcuts.ts";

export type Scope = "global" | "menu" | "home" | "homein" | "tabs" | "sistema" | "sistemaedit" | "sistemapvx" | "session" | "block" | "palette" | "form" | "result" | "log" | "modules" | "catalog" | "actions" | "add" | "review" | "files" | "search" | "modal" | `page:${string}`;

export interface Shortcut {
  /** Display text, also the spec for `matchKey`: `ctrl+k`, `esc`, `?`, `L`, `enter`. */
  keys: string;
  label: string;
  scope: Scope;
  /** Shown in the footer line (while its scope is active). Rows without it still show in the `?` help for their scope. */
  footer?: boolean;
  /** Shown in the action row under the focused block. */
  hint?: boolean;
  /** Replaces the global row with the same keys in this scope's footer and help (an empty label hides it). */
  over?: boolean;
}

/** The ONE shortcut table: the footer line and the `?` help both render from it. Add rows here. */
const base: readonly Shortcut[] = [
  { keys: "esc", label: "voltar", scope: "global", footer: true },
  { keys: "?", label: "ajuda", scope: "global", footer: true },
  { keys: "ctrl+c", label: "sair", scope: "global" },
  { keys: "↑↓", label: "move", scope: "menu", footer: true },
  { keys: "enter", label: "abre", scope: "menu", footer: true },
  { keys: "/", label: "comando", scope: "menu" },
  { keys: "ctrl+k", label: "palette", scope: "menu", footer: true },
  { keys: "tab", label: "abas", scope: "menu", footer: true },
  { keys: "a", label: "adiciona módulo", scope: "menu" },
  { keys: "esc", label: "sobe um nível", scope: "menu" },
  { keys: "↑↓←→", label: "cartão", scope: "modules", footer: true },
  { keys: "enter", label: "ações", scope: "modules", footer: true },
  { keys: "c", label: "catálogo", scope: "modules", footer: true },
  { keys: "a", label: "adicionar", scope: "modules", footer: true },
  { keys: "?", label: "ajuda", scope: "modules", footer: true, over: true },
  { keys: "esc", label: "", scope: "modules", over: true }, // nothing to go back to: keeps the footer to five rows
  { keys: "l", label: "comandos e páginas", scope: "modules" },
  { keys: "t", label: "mostra ou oculta a aba", scope: "modules" },
  { keys: "w", label: "widgets no Início", scope: "modules" },
  { keys: "u", label: "atualiza", scope: "modules" },
  { keys: "r", label: "revisa", scope: "modules" },
  { keys: "d", label: "ativa ou desativa", scope: "modules" },
  { keys: "x", label: "remove", scope: "modules" },
  { keys: "◆", label: "oficial (vem com o pvx)", scope: "modules" },
  { keys: "◇", label: "externo", scope: "modules" },
  { keys: "∞", label: "confia sempre", scope: "modules" },
  { keys: "⚠", label: "pede atenção", scope: "modules" },
  { keys: "↑↓←→", label: "cartão", scope: "catalog", footer: true },
  { keys: "enter", label: "ações", scope: "catalog", footer: true },
  { keys: "c", label: "instalados", scope: "catalog", footer: true },
  { keys: "a", label: "adiciona por repositório", scope: "catalog" },
  { keys: "?", label: "ajuda", scope: "catalog", footer: true, over: true },
  { keys: "esc", label: "", scope: "catalog", over: true },
  { keys: "↑↓", label: "escolhe", scope: "actions", footer: true },
  { keys: "enter", label: "confirma", scope: "actions", footer: true },
  { keys: "esc", label: "fecha", scope: "actions", footer: true },
  { keys: "?", label: "", scope: "actions", over: true },
  { keys: "enter", label: "clona e revisa", scope: "add", footer: true },
  { keys: "←→", label: "cursor", scope: "add" },
  { keys: "esc", label: "cancela", scope: "add" },
  { keys: "↑↓", label: "move", scope: "files", footer: true },
  { keys: "enter", label: "abre", scope: "files", footer: true },
  { keys: "esc", label: "volta", scope: "files" },
  { keys: "↑↓←→", label: "painel", scope: "home", footer: true },
  { keys: "enter", label: "entra", scope: "home", footer: true },
  { keys: "1-3", label: "painel", scope: "home" },
  { keys: "n", label: "nova nota", scope: "home" },
  { keys: "r", label: "atualiza", scope: "home", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "home" },
  { keys: "↑↓", label: "item", scope: "homein", footer: true },
  { keys: "enter", label: "usa", scope: "homein", footer: true },
  { keys: "esc", label: "sai", scope: "homein", footer: true },
  { keys: "r", label: "atualiza", scope: "homein", footer: true },
  { keys: "n", label: "nova nota", scope: "homein" },

  { keys: "tab", label: "abas", scope: "home" },
  { keys: "←→", label: "troca aba", scope: "tabs", footer: true },
  { keys: "↓/enter", label: "entra na aba", scope: "tabs", footer: true },
  { keys: "tab", label: "próxima aba", scope: "tabs", footer: true },
  { keys: "/", label: "comando", scope: "tabs" },
  { keys: "shift+tab", label: "aba anterior", scope: "tabs" },
  { keys: "ctrl+k", label: "palette", scope: "tabs", footer: true },
  { keys: "r", label: "atualiza", scope: "tabs" }, // core tabs only (conformidade, plano, logs); shown inline there, not in the footer
  { keys: "↑↓", label: "move", scope: "sistema", footer: true },
  { keys: "←→", label: "muda", scope: "sistema", footer: true },
  { keys: "enter", label: "muda/edita", scope: "sistema", footer: true },
  { keys: "esc", label: "abas", scope: "sistema", footer: true },
  { keys: "1/2", label: "seção", scope: "sistema", footer: true },
  { keys: "↑↓", label: "move", scope: "sistemapvx", footer: true },
  { keys: "enter", label: "age", scope: "sistemapvx", footer: true },
  { keys: "esc", label: "abas", scope: "sistemapvx", footer: true },
  { keys: "1/2", label: "seção", scope: "sistemapvx", footer: true },
  { keys: "enter", label: "aplica", scope: "sistemaedit", footer: true },
  { keys: "esc", label: "cancela", scope: "sistemaedit", footer: true },
  { keys: "←→", label: "cursor", scope: "sistemaedit" },
  { keys: "←→", label: "cursor", scope: "session" },
  { keys: "↑", label: "histórico", scope: "session", footer: true },
  { keys: "ctrl+r", label: "busca", scope: "session" },
  { keys: "!!", label: "repete", scope: "session" },
  { keys: "!", label: "host shell", scope: "session", footer: true }, // runs as the invoking user, audited when writable; typed text goes to the history
  { keys: "#", label: "páginas", scope: "session" },
  { keys: "ctrl+k", label: "palette", scope: "session", footer: true },
  { keys: "ctrl+l", label: "limpa", scope: "session" },
  { keys: "tab", label: "completa", scope: "session" },
  { keys: "esc", label: "foca os blocos", scope: "session" }, // empty input; with no blocks it focuses the tab bar (shift+tab always does)
  { keys: "enter", label: "roda", scope: "session" },
  { keys: "enter", label: "escolhe", scope: "search", footer: true },
  { keys: "esc", label: "sai", scope: "search" },
  { keys: "enter", label: "envia", scope: "modal" },
  { keys: "esc", label: "cancela", scope: "modal" },
  { keys: "tab", label: "campo", scope: "form", footer: true },
  { keys: "←→", label: "cursor", scope: "form", footer: true },
  { keys: "space", label: "marca", scope: "form", footer: true },
  { keys: "enter", label: "roda", scope: "form", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "form", footer: true },
  { keys: "enter", label: "voltar", scope: "result", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "log", footer: true },
  { keys: "↑↓", label: "move blocos", scope: "block", footer: true },
  { keys: "esc", label: "abas", scope: "block", footer: true },
  { keys: "r", label: "repetir", scope: "block", footer: true, hint: true },
  { keys: "l", label: "log", scope: "block", footer: true, hint: true },
  { keys: "c", label: "copiar", scope: "block", footer: true, hint: true },
  { keys: "x", label: "encerrar", scope: "block", hint: true }, // hint row only while the block runs (Blocks.tsx)
];

/** Base rows plus the palette's own, one row per keys + scope (the first one wins). */
export const shortcuts: readonly Shortcut[] = [...new Map([...base, ...paletteShortcuts].map((s) => [`${s.scope}:${s.keys}`, s])).values()];

/** Rows a module's page adds to its own scope (`page:<key>`): the table stays the one source for footer and help. */
const pageRows = new Map<Scope, Shortcut[]>();
/** Rows of `useKey`, added while the calling component is mounted. */
const dynRows = new Map<Scope, Set<Shortcut>>();
const listeners = new Set<() => void>();
let rev = 0;
const touch = () => (rev++, listeners.forEach((f) => f()));
/** Changes when a page row is added or removed: the footer and `?` re-render on it. */
export const rowsRev = () => rev;
export const subscribeRows = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
/** The page's static rows. Called while rendering, before the footer renders: no notification (a setState there is an error). */
export const setPageRows = (scope: Scope, rows: Shortcut[]) => void pageRows.set(scope, rows);
/** Adds one row; returns the remover. */
export function addPageRow(scope: Scope, row: Shortcut): () => void {
  const set = dynRows.get(scope) ?? dynRows.set(scope, new Set()).get(scope)!;
  set.add(row);
  touch();
  return () => (set.delete(row), touch());
}
const rowsOf = (scope: Scope) => [...shortcuts, ...(pageRows.get(scope) ?? []), ...(dynRows.get(scope) ?? [])];

/** Rows of the `review` scope. They name the commit, so the screen adds them with `addPageRow` once it knows it; `s` (file list) works but stays out of the footer. */
export function reviewRows(update: boolean, short?: string): Shortcut[] {
  const t = `confiar em ${short ?? "…"}`;
  const row = (keys: string, label: string, footer = true): Shortcut => ({ keys, label, scope: "review", footer });
  return update
    ? [row("t", t), row("s", "código"), row("p", "permissões"), row("↑↓", "rola", false), row("esc", "cancela")]
    : [row("↑↓", "arquivo"), row("enter", "editor"), row("t", t), row("T", "confiar sempre"), row("p", "permissões"), row("esc", "cancela"), row("s", "lista de arquivos", false)];
}

/** Footer entries for the active scope, global ones last. */
export const footerFor = (scope: Scope): Shortcut[] => {
  const rows = rowsOf(scope).filter((s) => s.scope === scope && scope !== "global");
  const own = rows.filter((s) => s.footer);
  return [...own, ...shortcuts.filter((s) => s.footer && s.scope === "global" && !rows.some((o) => o.keys === s.keys && (o.footer || o.over)))]; // a scope's own `esc` replaces the global one
};

/** Help rows: all rows of the scope (footer or not), then the global ones. */
export const helpFor = (scope: Scope): Shortcut[] => {
  const own = rowsOf(scope).filter((s) => s.scope === scope && scope !== "global");
  return [...own.filter((s) => s.label), ...shortcuts.filter((s) => s.scope === "global" && !own.some((o) => o.over && o.keys === s.keys))];
};

/** Inline hint text from table rows: `hintText("session", "tab", "enter")` -> `tab completa · enter roda`. */
export const hintText = (scope: Scope, ...keys: string[]) =>
  keys.map((k) => { const s = shortcuts.find((r) => r.scope === scope && r.keys === k)!; return `${s.keys} ${s.label}`; }).join(" · ");

const NAMES: Record<string, string> = { esc: "escape", enter: "return", "↑": "up", "↓": "down", "←": "left", "→": "right" };

/**
 * True if the key event matches `spec` (`[ctrl+|shift+]name`).
 * Shift pitfall: `key.name` is lowercase even with Shift, only `key.sequence` carries `L`.
 * So a single character (`l`, `L`, `?`, `space`) matches on `sequence`, never with ctrl.
 */
export function matchKey(key: KeyEvent, spec: string): boolean {
  if (spec === "ctrl+j" && key.name === "linefeed") return true; // plain terminals: ctrl+j is a raw \n
  const parts = spec === "+" ? ["+"] : spec.split("+");
  const name = parts.pop()!;
  const mods = new Set(parts);
  if (!!key.ctrl !== mods.has("ctrl") || key.meta) return false; // no alt/meta combos: macOS terminals do not send them
  if (!mods.size) {
    if (name === "space") return key.sequence === " ";
    if ([...name].length === 1 && !NAMES[name]) return key.sequence === name;
  }
  const want = NAMES[name] ?? name;
  return !!key.shift === mods.has("shift") && (key.name === want || (want === "return" && key.name === "enter"));
}
