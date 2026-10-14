import { compareSemver } from "@pvx/core";

/** The sections of the Sistema tab, in the order of their numbers. */
export const SECTIONS = ["aparencia", "pvx"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABELS: Record<Section, string> = { aparencia: "aparência", pvx: "pvx" };

/** The section a `1`/`2` key jumps to. */
export function sectionOfKey(sequence: string): Section | undefined {
  return SECTIONS[Number(sequence) - 1];
}

/** The state of the "verificar" action. */
export type ReleaseCheck =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; available: string }
  | { status: "error"; message: string };

export interface PvxFacts {
  /** The label shown in the tab bar, e.g. `0.1.0` or `0.1.0 (nightly, dev)`. */
  version: string;
  /** The installed binary, or null when running from source. */
  binary: string | null;
  home: string;
  usermodules: string;
  catalog: string;
  modules: number;
}

export interface InfoRow {
  label: string;
  value: string;
}

const FROM_SOURCE = "rodando pelo bun";

export function platformLabel(): string {
  return `${process.platform}/${process.arch}`;
}

export function pvxInfoRows(facts: PvxFacts): InfoRow[] {
  return [
    { label: "versão", value: facts.version },
    { label: "plataforma", value: platformLabel() },
    { label: "binário", value: facts.binary ?? FROM_SOURCE },
    { label: "PVX_HOME", value: facts.home },
    { label: "módulos de usuário", value: facts.usermodules },
    { label: "catálogo", value: facts.catalog },
    { label: "módulos", value: `${facts.modules} carregados` },
  ];
}

/** The plain version of a label: `0.1.0 (nightly, dev)` becomes `0.1.0`. */
export function plainVersion(label: string): string {
  return label.split(" ")[0]!;
}

const isDevBuild = (label: string) => label.includes(" (");

/** What the "disponível" line shows for each state of the check. */
export function availableText(check: ReleaseCheck): string {
  if (check.status === "done") return check.available;
  if (check.status === "error") return check.message;
  return "—";
}

/** Why "atualizar" is off, or undefined when it can run. A dev build counts as updatable: it is not a release. */
export function updateBlocker(facts: PvxFacts, check: ReleaseCheck): string | undefined {
  if (!facts.binary) return "rodando pelo bun: não há binário para atualizar";
  if (check.status !== "done") return "verifique antes de atualizar";
  if (isDevBuild(facts.version)) return undefined;
  if (compareSemver(check.available, plainVersion(facts.version)) <= 0) return "já está na versão mais recente";
  return undefined;
}

/** Ends `text` with `…` when it is longer than `width`. */
export function fit(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
