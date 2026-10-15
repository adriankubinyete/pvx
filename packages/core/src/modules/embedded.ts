import type { BuiltinModule } from "@pvx/sdk";

/** What a dev build records about a module checkout it carries: where it came from and whether it had uncommitted changes. */
export interface EmbeddedInfo {
  id: string;
  version: string;
  /** Absolute path of the checkout on the machine that built the binary. */
  source: string;
  /** Short sha of the checkout's HEAD. */
  commit: string;
  dirty: boolean;
}

/** A module a dev build carries: shaped like a builtin (manifest and factory), plus its provenance. */
export interface EmbeddedModule extends BuiltinModule {
  info: EmbeddedInfo;
}

/** The global the dev build's generated entry fills before the app starts; a release build never sets it. */
export const EMBEDDED_GLOBAL = "__PVX_EMBEDDED__";

export function embeddedFromBuild(): EmbeddedModule[] {
  const found = (globalThis as Record<string, unknown>)[EMBEDDED_GLOBAL];
  return Array.isArray(found) ? (found as EmbeddedModule[]) : [];
}

/** The mark of a dev build, in the format of the nightly mark: `dev, +alpha +beta`, or `dev` alone. */
export function devMark(ids: readonly string[]): string {
  if (!ids.length) return "dev";
  const plusIds = ids.map((id) => `+${id}`);
  return `dev, ${plusIds.join(" ")}`;
}

/** `0c94e67`, or `0c94e67*` when the checkout had uncommitted changes. */
export function commitLabel(info: Pick<EmbeddedInfo, "commit" | "dirty">): string {
  return info.dirty ? `${info.commit}*` : info.commit;
}

export function embeddedText(info: EmbeddedInfo): string {
  return `${info.id} ${info.version} ${commitLabel(info)} (${info.source})`;
}

/** The aviso Início shows when an installed or linked module lost to the embedded copy of the same id. */
export function shadowNotice(id: string): string {
  return `${id}: usando a cópia embutida no binário dev; a instalada foi ignorada`;
}

/** What `pvx version --json` reports. `buildId` is the dev build's id, absent in a release. */
export interface VersionInfo {
  version: string;
  label: string;
  buildId?: string;
  embedded: EmbeddedInfo[];
}

export function versionInfo(label: string, buildId: string | undefined, embedded: Iterable<EmbeddedInfo>): VersionInfo {
  const plain = label.split(" ")[0]!;
  const info: VersionInfo = { version: plain, label, embedded: [...embedded].map(plainInfo) };
  if (buildId) info.buildId = buildId;
  return info;
}

/** Only the recorded fields: the generated record may carry more (the release guard's marker). */
function plainInfo(info: EmbeddedInfo): EmbeddedInfo {
  return { id: info.id, version: info.version, source: info.source, commit: info.commit, dirty: info.dirty };
}
