import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@pvx/sdk";
import { isCatalogUrl } from "../catalog/index.ts";
import { usermodulesDir } from "../engine/paths.ts";
import { audit, disabledSet, invalidateUpdateCache, isLink, matchSha, msg, updateCheckFile, validId } from "./common.ts";
import * as G from "./git.ts";
import { approve, getTrust, readJson, writeJsonAtomic } from "./trust.ts";

type Perms = NonNullable<Manifest["permissions"]>;
const KINDS = ["exec", "net", "fs"] as const;

/** Permissions the new commit adds and drops against what the technician approved. */
export interface PermDiff {
  added: Perms;
  removed: Perms;
  changed: boolean;
}
export function diffPermissions(before: Perms = {}, after: Perms = {}): PermDiff {
  const d: PermDiff = { added: {}, removed: {}, changed: false };
  for (const k of KINDS) {
    const a = after[k] ?? [];
    const b = before[k] ?? [];
    const add = a.filter((x) => !b.includes(x));
    const rem = b.filter((x) => !a.includes(x));
    if (add.length) (d.added[k] = add), (d.changed = true);
    if (rem.length) (d.removed[k] = rem), (d.changed = true);
  }
  return d;
}

export interface UpdateCheck {
  id: string;
  /** Commits upstream has and HEAD lacks. */
  behind: number;
  commits: { sha: string; subject: string }[];
  /** Upstream HEAD after the fetch: what `--trust` must match. */
  remoteSha?: string;
  fromSha: string;
  permissions: PermDiff;
  /** HEAD and upstream both have commits the other lacks: no fast-forward. */
  diverged: boolean;
  /** Why the new manifest could not be read (the update is refused). */
  manifestError?: string;
  /** Local changes in the tree (the merge would be refused). */
  dirty: number;
}

type CheckResult = { ok: true; check: UpdateCheck } | { ok: false; error: string };

const moduleDir = (id: string) => join(usermodulesDir(), validId(id));

/** `git fetch`, then what is new and how the permissions change vs the TRUSTED manifest (the HEAD one when never approved). Never touches the working tree. */
export async function checkUpdates(id: string, o: { allowFile?: boolean } = {}): Promise<CheckResult> {
  try {
    const dir = moduleDir(id);
    if (!existsSync(dir)) throw new Error(`módulo "${id}" não instalado em usermodules`);
    if (isLink(dir)) throw new Error(`"${id}" é um módulo dev (link): edite a pasta de origem, não há atualização`);
    await G.fetch(dir, o.allowFile);
    invalidateUpdateCache();
    const fromSha = await G.headSha(dir);
    const ab = await G.aheadBehind(dir);
    if (!ab) throw new Error(`"${id}" não acompanha um branch remoto (instalado com --ref fixo?)`);
    const check: UpdateCheck = { id, behind: ab.behind, commits: [], fromSha, permissions: diffPermissions(), diverged: ab.ahead > 0 && ab.behind > 0, dirty: await G.dirtyCount(dir) };
    if (!ab.behind) return { ok: true, check };
    check.commits = await G.newCommits(dir);
    check.remoteSha = await G.upstreamSha(dir);
    const before = getTrust(id)?.permissions ?? (JSON.parse(await G.showFile(dir, "HEAD", "pvx-module.json")) as Manifest).permissions;
    try {
      const next = JSON.parse(await G.showFile(dir, check.remoteSha, "pvx-module.json")) as Manifest;
      if (next.id !== id) throw new Error(`o novo manifest declara o id "${next.id}"`);
      check.permissions = diffPermissions(before, next.permissions);
    } catch (e) {
      check.manifestError = `manifest do commit novo ilegível: ${msg(e)}`;
    }
    return { ok: true, check };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export type UpdateResult =
  | { ok: true; status: "ja-atualizado" | "pendente" | "atualizado"; id: string; check: UpdateCheck; sha: string; /** Applied by an "always" approval, no --trust. */ auto?: true }
  | { ok: false; id: string; error: string; check?: UpdateCheck };

/**
 * Fetches and reports. Moves the working tree ONLY with `trust` = the fetched upstream sha (full or 7+ prefix): then it
 * fast-forwards to exactly that sha and approves it. Without it the module stays on the approved commit (state `atras`).
 * Exception: an "always" approval whose origin URL is unchanged applies the fetched sha by itself (`auto`), whatever it adds.
 * An approved module whose origin is in the catalog counts as "always" too, and the record is upgraded when it applies.
 */
export async function updateModule(id: string, o: { trust?: string; allowFile?: boolean } = {}): Promise<UpdateResult> {
  const r = await checkUpdates(id, o);
  if (!r.ok) return { ok: false, id, error: r.error };
  const { check } = r;
  const fail = (error: string): UpdateResult => ({ ok: false, id, error, check });
  if (!check.behind) return { ok: true, status: "ja-atualizado", id, check, sha: check.fromSha };
  if (check.diverged) return fail("não é fast-forward: o histórico local e o remoto divergiram; resolva no diretório do módulo");
  const dir = moduleDir(id);
  const prior = getTrust(id);
  const url = await G.originUrl(dir).catch(() => undefined);
  // An explicit --trust on an always record keeps it (same origin); only `modules trust` without the flag clears it.
  const sticky = Boolean(prior?.always && url && prior.url === url);
  // Legacy catalog installs were approved one commit at a time; the cached catalog makes them "always" now.
  const viaCatalog = !sticky && Boolean(prior && url && (await isCatalogUrl(url, { allowFile: o.allowFile })));
  const always = sticky || viaCatalog;
  const auto = always && o.trust === undefined;
  if (o.trust === undefined && !auto) {
    audit(`update disponível: ${id} ${check.fromSha.slice(0, 7)}..${check.remoteSha!.slice(0, 7)} (${check.behind} commit(s)); sem aprovação`);
    return { ok: true, status: "pendente", id, check, sha: check.fromSha };
  }
  if (!auto && !matchSha(check.remoteSha!, o.trust!)) return fail(`--trust ${o.trust} não confere com o commit remoto ${check.remoteSha}`);
  if (check.manifestError) return fail(check.manifestError);
  if (check.dirty) return fail(`árvore alterada localmente (${check.dirty} caminho(s)): limpe antes de atualizar`);
  try {
    await G.mergeFfOnly(dir, check.remoteSha!);
    const head = await G.headSha(dir);
    const next = JSON.parse(await G.showFile(dir, head, "pvx-module.json")) as Manifest;
    approve(id, { url: url ?? "(local)", sha: head, permissions: next.permissions, always });
    audit(auto ? `trust automático (${viaCatalog ? "catálogo" : "sempre"}): ${id} ${head} (${url})` : `update aprovado: ${id} ${check.fromSha.slice(0, 7)} -> ${head.slice(0, 7)}`);
    invalidateUpdateCache();
    return { ok: true, status: "atualizado", id, check, sha: head, ...(auto ? { auto: true as const } : {}) };
  } catch (e) {
    return fail(msg(e));
  }
}

/** Installed git modules (not links, not disabled). */
export function installedIds(): string[] {
  const root = usermodulesDir();
  if (!existsSync(root)) return [];
  const off = disabledSet();
  return readdirSync(root)
    .filter((n) => !n.startsWith(".") && !off.has(n) && !lstatSync(join(root, n)).isSymbolicLink())
    .sort();
}

// ---------------------------------------------------------------- notice cache

export interface Pending {
  id: string;
  behind: number;
}
const TTL_MS = 6 * 3600_000;
const LIMIT_MS = 2000;

/**
 * Modules with commits upstream, for the TUI banner (interactive mode only: the CLI never calls it). Cached in
 * PVX_HOME/update-check.json for 6 h; a refresh fetches every module in parallel within 2 s and swallows any failure.
 */
export async function pendingUpdates(o: { now?: number; ttlMs?: number; limitMs?: number; allowFile?: boolean } = {}): Promise<Pending[]> {
  const now = o.now ?? Date.now();
  const cached = readJson<{ at?: number; pending?: Pending[] } | null>(updateCheckFile(), null);
  if (cached?.at !== undefined && cached.pending && now - cached.at < (o.ttlMs ?? TTL_MS)) return cached.pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = Promise.all(
    installedIds().map(async (id): Promise<Pending | null> => {
      const dir = join(usermodulesDir(), id);
      try {
        await G.fetch(dir, o.allowFile, o.limitMs ?? LIMIT_MS);
      } catch {} // offline: fall back to what is already fetched
      const ab = await G.aheadBehind(dir);
      return ab?.behind ? { id, behind: ab.behind } : null;
    }),
  );
  const limit = new Promise<null>((res) => (timer = setTimeout(() => res(null), o.limitMs ?? LIMIT_MS + 500)));
  try {
    const got = await Promise.race([refresh, limit]);
    if (!got) return cached?.pending ?? [];
    const pending = got.filter((p): p is Pending => p !== null);
    try {
      writeJsonAtomic(updateCheckFile(), { at: now, pending });
    } catch {}
    return pending;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
