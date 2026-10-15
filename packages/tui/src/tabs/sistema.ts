import { commitLabel, compareSemver, type EmbeddedInfo } from "@pvx/core";
import { accents, type AccentName } from "../theme.ts";

/** The sections of the Sistema tab, in the order of their numbers. */
export const SECTIONS = ["pvx", "aparencia", "avancado"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_TITLES: Record<Section, string> = { pvx: "pvx", aparencia: "aparência", avancado: "avançado" };

/** The section a `1`/`2`/`3` key jumps to. */
export function sectionOfKey(sequence: string): Section | undefined {
  return SECTIONS[Number(sequence) - 1];
}

/** The rows the cursor stops on, in the order they are drawn. */
export const ROW_IDS = ["update", "theme", "accent", "symbols", "border", "result", "edit", "tasks"] as const;
export type RowId = (typeof ROW_IDS)[number];
export const SECTION_OF_ROW: Record<RowId, Section> = { update: "pvx", theme: "aparencia", accent: "aparencia", symbols: "aparencia", border: "aparencia", result: "aparencia", edit: "aparencia", tasks: "avancado" };

/** The first row of a section: where the number key puts the cursor. */
export const firstRowOf = (section: Section): RowId => ROW_IDS.find((row) => SECTION_OF_ROW[row] === section)!;

export type Options = readonly (readonly [value: string, label: string])[];
/** The axes that are a choice among a few words: state key, row label and the values with their display names. */
export interface ChoiceAxis {
  id: "theme" | "symbols" | "border" | "result";
  label: string;
  options: Options;
}
export const CHOICE_AXES: readonly ChoiceAxis[] = [
  { id: "theme", label: "tema", options: [["dark", "Escuro"], ["light", "Claro"], ["contrast", "Alto contraste"], ["terminal", "Terminal"], ["custom", "Personalizado"]] },
  { id: "symbols", label: "símbolos", options: [["unicode", "unicode"], ["ascii", "ascii"]] },
  { id: "border", label: "moldura", options: [["rounded", "arredondada"], ["single", "simples"], ["none", "nenhuma"]] },
  { id: "result", label: "resultado", options: [["bracket", "colchetes"], ["glyph", "símbolo"], ["text", "texto"]] },
];
export const choiceAxisOf = (row: RowId): ChoiceAxis | undefined => CHOICE_AXES.find((axis) => axis.id === row);

/** The accent: `tema` keeps the theme's own, the others are the presets. */
export const ACCENT_OPTIONS: Options = [["tema", "tema"], ["menta", "menta"], ["azul", "azul"], ["ambar", "âmbar"], ["roxo", "roxo"]];
/** The color of a preset swatch; `tema` has none of its own (the caller draws the theme's accent). */
export const presetColor = (value: string): string | undefined => (Object.hasOwn(accents, value) ? accents[value as AccentName] : undefined);

/** The option after (or before) `value`, wrapping at the ends. */
export function cycle(options: Options, value: string, delta: number): string {
  const index = Math.max(0, options.findIndex(([option]) => option === value));
  return options[(index + delta + options.length) % options.length]![0];
}

/** The state of the "verificar" action. */
export type ReleaseCheck =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; available: string }
  | { status: "error"; message: string };

export interface PvxFacts {
  /** The label shown in the tab bar, e.g. `0.1.0` or `0.1.0 (dev, +alpha)`. */
  version: string;
  /** The installed binary, or null when running from source. */
  binary: string | null;
  home: string;
  modules: number;
  /** The modules a dev build carries (empty in a release). */
  embedded: readonly EmbeddedInfo[];
}

export interface InfoRow {
  label: string;
  value: string;
}

const FROM_SOURCE = "rodando pelo bun";

export function platformLabel(): string {
  return `${process.platform}/${process.arch}`;
}

/** The rows of the pvx section that only say something (the update row and the uninstall hint are drawn apart). */
export function pvxInfoRows(facts: PvxFacts): { version: InfoRow; platform: InfoRow; data: InfoRow; embedded?: InfoRow } {
  const embedded = embeddedSummary(facts);
  return {
    version: { label: "versão", value: facts.version },
    platform: { label: "plataforma", value: `${platformLabel()} · ${facts.binary ? `binário ${facts.binary}` : FROM_SOURCE}` },
    data: { label: "dados", value: `${facts.home} · ${facts.modules} ${facts.modules === 1 ? "módulo carregado" : "módulos carregados"}` },
    ...(embedded ? { embedded: { label: "embutidos", value: embedded } } : {}),
  };
}

/** `firewall 0c94e67 · issabel 7971725`: the modules a dev build carries, with their commits; nothing in a release. */
export function embeddedSummary(facts: PvxFacts): string | undefined {
  if (!facts.embedded.length) return undefined;
  return facts.embedded.map((info) => `${info.id} ${commitLabel(info)}`).join(" · ");
}

/** The plain version of a label: `0.1.0 (nightly, dev)` becomes `0.1.0`. */
export function plainVersion(label: string): string {
  return label.split(" ")[0]!;
}

const isDevBuild = (label: string) => label.includes(" (");

/** Why "atualizar" is off, or undefined when it can run. A dev build counts as updatable: it is not a release. */
export function updateBlocker(facts: PvxFacts, check: ReleaseCheck): string | undefined {
  if (!facts.binary) return "sem binário";
  if (check.status !== "done") return "verifique antes";
  if (isDevBuild(facts.version)) return undefined;
  if (compareSemver(check.available, plainVersion(facts.version)) <= 0) return "na versão mais recente";
  return undefined;
}

/** What the update row says before its buttons: the result of the check, or why there is none. */
export function updateStatus(check: ReleaseCheck, blocker: string | undefined): { text: string; tone: "dim" | "accent" | "error" } {
  if (check.status === "error") return { text: check.message, tone: "error" };
  if (check.status === "done" && !blocker) return { text: `${check.available} disponível`, tone: "accent" };
  return { text: blocker ?? "—", tone: "dim" };
}

/** Ends `text` with `…` when it is longer than `width`. */
export function fit(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
