import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Manifest, OutLine } from "@pvx/sdk";
import { moduleStateDir, usermodulesDir } from "../engine/paths.ts";
import { readManifestRaw } from "../engine/manifest.ts";
import { checkPlatform, hostPlatform, type HostPlatform, type PlatformCheck } from "../engine/platform.ts";
import type { Registry } from "../engine/registry.ts";
import { analyze, hitLines, readSources, type Hit } from "./analyze.ts";
import { buildFiles, type ReviewFile } from "./graph.ts";
import { summarizeCommands, summarizePermissions, type CommandSummary, type PermissionSummary } from "./review-summary.ts";
import * as G from "./git.ts";
import { audit, devLinks, disabledSet, invalidateUpdateCache, isLink, isRegisteredDev, matchSha, msg, setDevLinks, validId, writeDisabled, type Result } from "./common.ts";
import { approve, getTrust, revoke } from "./trust.ts";
import type { EmbeddedInfo } from "./embedded.ts";

export * from "./trust.ts";
export * from "./dev.ts";
export * from "./update.ts";
export * from "./live.ts";
export * from "./embedded.ts";
export { audit, devLinks, invalidateUpdateCache, type Result };
export { GitError, checkUrl } from "./git.ts";
export { analyze };
export type { Hit, ReviewFile, CommandSummary, PermissionSummary };
export { BROAD_EXEC, summarizeCommands, summarizePermissions } from "./review-summary.ts";
export type { CommitInfo } from "./git.ts";

export type ModuleState = "aguardando-confianca" | "carregado" | "desativado" | "erro" | "modificado" | "atras" | "dev";

export interface ModuleRow {
  id: string;
  state: ModuleState;
  version?: string;
  /** Ships with pvx (not on disk). */
  official?: boolean;
  /** Carried by a dev build (not on disk): it wins over an installed copy of the same id. */
  embedded?: EmbeddedInfo;
  url?: string;
  ref?: string;
  sha?: string;
  /** Changed paths in the git tree. */
  dirty?: number;
  /** Commits the already-fetched upstream has and HEAD lacks. */
  behind?: number;
  /** Trusted always: new commits from the same origin apply without review. */
  always?: true;
  /** Why the module does not fit this system (PlatformCheck.text); unset when it fits. */
  incompatible?: string;
  error?: string;
}

// ---------------------------------------------------------------- state

/** Everything decided from disk alone: never imports, never fetches. `carregado` here means "eligible to import". */
async function diskState(dir: string, id: string): Promise<ModuleRow> {
  const row: ModuleRow = { id, state: "carregado" };
  if (disabledSet().has(id)) return { ...row, state: "desativado" };
  if (isLink(dir)) {
    return isRegisteredDev(dir, id) ? { ...row, state: "dev" } : { ...row, state: "aguardando-confianca", error: "symlink não registrado; use pvx modules link" };
  }
  if (!(await G.isRepoRoot(dir))) return { ...row, state: "aguardando-confianca", error: "não é um repositório git" };
  try {
    row.url = await G.originUrl(dir).catch(() => undefined);
    row.sha = await G.headSha(dir);
    row.ref = await G.currentRef(dir);
    row.dirty = await G.dirtyCount(dir);
  } catch {
    return { ...row, state: "aguardando-confianca", error: "não é um repositório git" };
  }
  const t = getTrust(id);
  if (t?.always) row.always = true;
  if (!t || t.sha !== row.sha) return { ...row, state: "aguardando-confianca" };
  return { ...row, state: row.dirty ? "modificado" : "carregado" };
}

/** Plug into `loadModules({canImport})`. Dev links load with a warning; everything else needs HEAD == approved sha, clean tree, not disabled. */
export function trustGate(o: { warn?: (msg: string) => void } = {}) {
  return async (dir: string, manifest: Manifest): Promise<boolean> => {
    const { state } = await diskState(dir, manifest.id);
    if (state === "dev") o.warn?.(`módulo "${manifest.id}" em modo dev (link): sem confiança por commit`);
    return state === "carregado" || state === "dev";
  };
}

/** The row of a module a dev build carries: loaded unless its registration failed. */
function embeddedRow(id: string, info: EmbeddedInfo, registry: Registry): ModuleRow {
  const row: ModuleRow = { id, state: "carregado", version: info.version, embedded: info };
  const failure = registry.errors.find((e) => e.id === id);
  if (failure) {
    row.state = "erro";
    row.error = failure.error;
  }
  return row;
}

/** Every module with its `--json` state. `registry` tells loaded from errored; with none, eligible modules count as loaded. */
export async function listModules(registry?: Registry, host: HostPlatform = hostPlatform()): Promise<ModuleRow[]> {
  const rows: ModuleRow[] = [];
  const seen = new Set<string>();
  for (const b of registry?.official ?? []) {
    seen.add(b);
    rows.push({ id: b, state: "carregado", official: true, version: registry!.modules.get(b)?.version });
  }
  if (registry) {
    for (const [id, info] of registry.embedded) {
      seen.add(id);
      rows.push(embeddedRow(id, info, registry));
    }
  }
  const root = usermodulesDir();
  const ids = existsSync(root) ? readdirSync(root).filter((n) => !n.startsWith(".")).sort() : [];
  for (const id of ids) {
    const dir = join(root, id);
    if (seen.has(id) || !existsSync(dir) || !(lstatSync(dir).isSymbolicLink() || lstatSync(dir).isDirectory())) continue;
    seen.add(id);
    let incompatible: string | undefined;
    try {
      const m = readManifestRaw(dir);
      if (m.applies?.file && !existsSync(m.applies.file)) continue; // not applicable here: the loader skips it too
      const pc = checkPlatform(m, host);
      if (!pc.ok) incompatible = pc.text;
    } catch {}
    const row = await diskState(dir, id);
    if (incompatible) row.incompatible = incompatible;
    row.version = registry?.modules.get(id)?.version ?? (() => { try { return readManifestRaw(dir).version; } catch { return undefined; } })();
    // A module in the registry passed the gate (or the host runs without one): a non-git dir is not "awaiting" then.
    if (registry?.modules.has(id) && row.state === "aguardando-confianca") (row.state = "carregado"), delete row.error;
    const err = registry?.errors.find((e) => e.id === id);
    if (err && row.state !== "desativado") {
      row.state = "erro";
      row.error = err.error;
    } else if (row.state === "carregado") {
      const ab = row.url ? await G.aheadBehind(dir) : null;
      if (ab?.behind) (row.state = "atras"), (row.behind = ab.behind);
    }
    rows.push(row);
  }
  for (const e of registry?.errors ?? []) if (!seen.has(e.id)) rows.push({ id: e.id, state: "erro", error: e.error });
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- review

export interface Review {
  dir: string;
  id: string;
  url?: string;
  ref?: string;
  sha: string;
  /** HEAD's metadata; `count` is the commits reachable from HEAD. */
  commit: G.CommitInfo;
  /** The sha now approved for this id in the trust store; unset on a first approval. */
  trustedBefore?: string;
  manifest: Manifest;
  compat: { ok: boolean; text: string };
  platform: PlatformCheck;
  contributes: NonNullable<Manifest["contributes"]>;
  /** Who collides with this module (id or command path); non-empty refuses the add. */
  conflicts: string[];
  permissions: NonNullable<Manifest["permissions"]>;
  /** Static analysis hits as `path:line: msg` text (warnings, not a guarantee). */
  warnings: string[];
  /** Code files with size, group, import graph from the entry and hits. Never source text. */
  files: ReviewFile[];
  /** Risky exec/fs declarations first; the rest only counted. */
  permissionSummary: PermissionSummary;
  /** `contributes.commands` grouped by first word. */
  commandSummary: CommandSummary;
}

export interface ReviewOpts {
  hostVersion?: string;
  registry?: Registry;
  /** First words of core commands: a module id equal to one would be shadowed. */
  reserved?: string[];
  /** Defaults to the running system. */
  host?: HostPlatform;
}

/** Reads the manifest WITHOUT importing and gathers what the technician must see before approving. */
export async function reviewModule(dir: string, o: ReviewOpts = {}): Promise<Review> {
  const manifest = readManifestRaw(dir);
  const id = manifest.id;
  const self = basename(dir) === id;
  const conflicts: string[] = [];
  const reg = o.registry;
  if (o.reserved?.includes(id)) conflicts.push(`id "${id}" é comando do núcleo`);
  if (!self) {
    if (reg?.modules.has(id)) conflicts.push(`id "${id}" já pertence ao módulo instalado "${id}"`);
    else if (existsSync(join(usermodulesDir(), id))) conflicts.push(`id "${id}" já pertence ao módulo instalado em usermodules/${id}`);
    for (const c of manifest.contributes?.commands ?? []) {
      const key = `${id} ${c}`.trim();
      const other = reg?.commands.get(key);
      if (other) conflicts.push(`comando "${key}" já pertence ao módulo "${other.moduleId}"`);
    }
  }
  let compat = { ok: true, text: "sem faixa de versão (qualquer pvx)" };
  if (manifest.pvx !== undefined) {
    const ok = !o.hostVersion || Bun.semver.satisfies(o.hostVersion, manifest.pvx);
    compat = { ok, text: ok ? `pvx ${manifest.pvx} (instalado: ${o.hostVersion ?? "?"})` : `requer pvx ${manifest.pvx} (instalado: ${o.hostVersion})` };
  }
  const git = await Promise.all([G.originUrl(dir).catch(() => undefined), G.currentRef(dir).catch(() => undefined), G.commitInfo(dir)]);
  const sources = readSources(dir);
  const hits = analyze(dir, sources);
  const permissions = manifest.permissions ?? {};
  const trustedBefore = getTrust(id)?.sha;
  return {
    dir, id, url: git[0], ref: git[1], sha: git[2].sha, commit: git[2], ...(trustedBefore ? { trustedBefore } : {}), manifest, compat,
    platform: checkPlatform(manifest, o.host ?? hostPlatform()), contributes: manifest.contributes ?? {}, conflicts, permissions,
    warnings: hitLines(hits), files: buildFiles(sources, manifest.entry, hits),
    permissionSummary: summarizePermissions(id, permissions), commandSummary: summarizeCommands(manifest.contributes?.commands),
  };
}

const list = (a?: string[]) => (a?.length ? a.join(", ") : "nada");
const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const MAX_LINES = 10;
function staticLine(f: ReviewFile): string {
  const nums = [...new Set(f.hits.map((h) => h.line))];
  const shown = nums.slice(0, MAX_LINES).join(", ") + (nums.length > MAX_LINES ? ` e mais ${nums.length - MAX_LINES}` : "");
  const msgs = [...new Set(f.hits.map((h) => h.msg))].join(", ");
  return `${f.path}: ${nums.length === 1 ? "linha" : "linhas"} ${shown} (${msgs}; ${f.used ? "usado pelo módulo" : "fora do caminho do entry"})`;
}

/** The review screen as lines, for the CLI (the TUI builds its own from the same `Review`). */
export function reviewLines(r: Review, hint: string): OutLine[] {
  const c = r.contributes;
  const p = r.permissions;
  const L = (kind: OutLine["kind"], text: string): OutLine => ({ kind, text });
  return [
    L("info", `origem: ${r.url ?? "(local)"}${r.ref ? ` (${r.ref})` : ""}`),
    L("info", `commit: ${r.sha}`),
    L("info", `autor: ${r.commit.author} · ${localDate(r.commit.date)} · ${r.commit.subject}`),
    L("info", `módulo: ${r.id} ${r.manifest.version}`),
    L(r.compat.ok ? "info" : "error", `compatibilidade: ${r.compat.text}`),
    L(r.platform.ok ? "info" : "error", `sistema: ${r.platform.text}`),
    L("info", `contribui: comandos ${list(c.commands)}; páginas ${list(c.pages)}; widgets ${list(c.widgets)}; capacidades ${list(c.capabilities)}`),
    L("info", `permissões: exec ${list(p.exec)}; net ${list(p.net)}; fs ${list(p.fs)} (declarativas, não é sandbox)`),
    ...r.conflicts.map((x) => L("error", `conflito: ${x}`)),
    ...r.files.filter((f) => f.hits.length).map((f) => L("warning", `análise estática: ${staticLine(f)}`)),
    L("warning", "este código roda como root; só aprove um commit que você revisou"),
    L("info", hint),
  ];
}

// ---------------------------------------------------------------- add / trust / remove / enable

export interface AddOpts {
  hostVersion: string;
  ref?: string;
  /** Approves the commit without a screen; must match HEAD (full sha or 7+ prefix). */
  trust?: string;
  /** With `trust`: the approval is "always" (every later commit from this origin applies without review). */
  always?: boolean;
  /** From the official catalog: after the checks the commit is approved "always", with no review screen (`trust` is not needed). */
  catalog?: boolean;
  /** Tests and link only. */
  allowFile?: boolean;
  /** Fails when the cloned manifest id differs (the catalog knows the id it asked for). */
  expectId?: string;
  registry?: Registry;
  reserved?: string[];
  /** Defaults to the running system. */
  host?: HostPlatform;
  /** Asked when the module does not declare this system; without it (or on false) the add is refused. */
  onIncompatible?: (review: Review) => Promise<boolean>;
}

export type AddResult =
  | { ok: true; status: "instalado" | "ja-instalado"; id: string; sha?: string; state: ModuleState; review?: Review }
  | { ok: false; error: string; review?: Review; incompatible?: true };

/**
 * Clones into usermodules/<id>, reviews, and approves only with `trust`. Nothing is imported here. Idempotent by origin URL.
 * Atomic: on any failure the clone is removed.
 */
export async function addModule(url: string, o: AddOpts): Promise<AddResult> {
  const root = usermodulesDir();
  let tmp = "";
  try {
    G.checkUrl(url, o.allowFile);
    if (existsSync(root)) {
      for (const id of readdirSync(root)) {
        if (id.startsWith(".")) continue;
        if (!isLink(join(root, id)) && (await G.originUrl(join(root, id)).catch(() => "")) === url) {
          return { ok: true, status: "ja-instalado", id, state: (await diskState(join(root, id), id)).state };
        }
      }
    }
    mkdirSync(root, { recursive: true });
    tmp = join(root, `.add-${process.pid}-${Date.now()}`);
    await G.clone(url, tmp, { ref: o.ref, allowFile: o.allowFile });
    const review = await reviewModule(tmp, o);
    const id = review.id;
    if (o.expectId && o.expectId !== id) throw new Error(`o manifest declara o id "${id}", esperado "${o.expectId}"`);
    if (review.conflicts.length) return { ok: false, error: `adição recusada: ${review.conflicts.join("; ")}`, review };
    if (o.trust !== undefined && !matchSha(review.sha, o.trust)) {
      return { ok: false, error: `--trust ${o.trust} não confere com o commit ${review.sha}`, review };
    }
    if (!review.platform.ok && !(o.onIncompatible && (await o.onIncompatible(review)))) {
      return { ok: false, error: `cancelado: ${review.platform.text}`, review, incompatible: true };
    }
    const dir = join(root, id);
    renameSync(tmp, dir);
    tmp = "";
    review.dir = dir;
    invalidateUpdateCache();
    if (o.trust === undefined && !o.catalog) return { ok: true, status: "instalado", id, sha: review.sha, state: "aguardando-confianca", review };
    approve(id, { url, sha: review.sha, permissions: review.permissions, always: o.always || o.catalog });
    audit(o.catalog ? `trust automático (catálogo): ${id} ${review.sha} (${url})` : `trust aprovado${o.always ? " (sempre)" : ""}: ${id} ${review.sha} (${url})`);
    return { ok: true, status: "instalado", id, sha: review.sha, state: (await diskState(dir, id)).state, review };
  } catch (e) {
    return { ok: false, error: msg(e) };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/** Approves the commit currently checked out; `sha` must match HEAD (full or 7+ prefix). `always` also trusts every later commit from this origin; absent, it clears a previous "always". */
export async function trustModule(id: string, sha: string, o: { always?: boolean } = {}): Promise<Result> {
  try {
    const dir = join(usermodulesDir(), validId(id));
    if (!existsSync(dir)) throw new Error(`módulo "${id}" não instalado`);
    const head = await G.headSha(dir);
    if (!matchSha(head, sha)) throw new Error(`--sha ${sha} não confere com o commit ${head}`);
    const m = readManifestRaw(dir);
    approve(id, { url: (await G.originUrl(dir).catch(() => undefined)) ?? "(local)", sha: head, permissions: m.permissions, always: o.always });
    audit(`trust aprovado${o.always ? " (sempre)" : ""}: ${id} ${head}`);
    return { ok: true, text: `${id} aprovado em ${head}${o.always ? " (confiança sempre)" : ""}` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export function revokeTrust(id: string): Result {
  try {
    if (!revoke(validId(id))) return { ok: false, error: `"${id}" não tem aprovação` };
    audit(`trust revogado: ${id}`);
    return { ok: true, text: `aprovação de ${id} revogada` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Removes the dir (a link loses only the link) and the trust; `modules/<id>/state` stays unless `purge`. */
export function removeModule(id: string, o: { purge?: boolean } = {}): Result {
  try {
    const dir = join(usermodulesDir(), validId(id));
    if (!existsSync(dir) && !isDanglingLink(dir)) throw new Error(`módulo "${id}" não instalado em usermodules`);
    rmSync(dir, { recursive: true, force: true }); // on a link this removes only the link, never the target
    revoke(id);
    if (devLinks().some((d) => d.id === id)) setDevLinks(devLinks().filter((d) => d.id !== id));
    invalidateUpdateCache();
    const off = disabledSet();
    if (off.delete(id)) writeDisabled(off);
    if (o.purge) rmSync(join(moduleStateDir(id), ".."), { recursive: true, force: true });
    audit(`módulo removido: ${id}${o.purge ? " (com --purge)" : ""}`);
    return { ok: true, text: `${id} removido${o.purge ? " com o estado" : "; estado preservado"}` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
const isDanglingLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

export function setEnabled(id: string, enabled: boolean): Result {
  try {
    validId(id);
    if (!existsSync(join(usermodulesDir(), id))) throw new Error(`módulo "${id}" não instalado em usermodules`);
    const off = disabledSet();
    if (enabled) off.delete(id);
    else off.add(id);
    writeDisabled(off);
    audit(`módulo ${enabled ? "ativado" : "desativado"}: ${id}`);
    return { ok: true, text: `${id} ${enabled ? "ativado" : "desativado"}` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
