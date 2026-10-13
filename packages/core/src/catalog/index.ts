import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logsDir, pvxHome, usermodulesDir } from "../engine/paths.ts";
import { createLogger } from "../logs/index.ts";
import embedded from "./embedded.json";

export const DEFAULT_CATALOG_URL = "https://registry.phonevox.com.br/pvx/catalog.json";
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

export interface CatalogEntry {
  id: string;
  url: string;
  descricao: string;
  versao?: string;
}
export type CatalogSource = "rede" | "cache" | "cache antigo" | "embutido";
export interface Catalog {
  modules: CatalogEntry[];
  source: CatalogSource;
  /** ms epoch of the network fetch behind this data (absent for "embutido"). */
  fetchedAt?: number;
}
export interface CatalogLoadOpts {
  fetchImpl?: typeof fetch;
  now?: number;
  /** Receives validation warnings; defaults to the `core` log (best effort). */
  warn?: (msg: string) => void;
  /** Tests only: entries may be file:// URLs (the add and update paths take the same flag). */
  allowFile?: boolean;
}

// NOT the update-notice cache: that one (spec "Avisos de atualização") is invalidated by add/update/remove.
// This catalog cache only expires by TTL, and `modules add` must not touch it.
const cachePath = () => join(pvxHome(), "catalog.json");
const ID_RE = /^[a-z0-9-]+$/;
const URL_RE = /^(https:\/\/\S+|ssh:\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/;
const FILE_URL_RE = /^file:\/\/\S+$/;

/** True for an https/ssh git URL (`ssh://…` or scp-like `git@host:path`). */
export const isModuleUrl = (s: string) => URL_RE.test(s);

const defaultWarn = (msg: string) => {
  try {
    createLogger(logsDir(), "core").warn(msg);
  } catch {}
};

/** Strict validation: invalid entries are dropped with a warning; garbage as a whole yields []. */
export function parseCatalog(data: unknown, warn: (m: string) => void = defaultWarn, allowFile = false): CatalogEntry[] {
  const d = data as { version?: unknown; modules?: unknown } | null;
  if (!d || typeof d !== "object" || d.version !== 1 || !Array.isArray(d.modules)) {
    warn("catálogo ignorado: formato inválido (esperado version 1 e modules[])");
    return [];
  }
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  d.modules.forEach((raw, i) => {
    const e = raw as Record<string, unknown> | null;
    const why =
      !e || typeof e !== "object" ? "não é um objeto"
      : typeof e.id !== "string" || !ID_RE.test(e.id) ? "id inválido"
      : typeof e.url !== "string" || !(URL_RE.test(e.url) || (allowFile && FILE_URL_RE.test(e.url))) ? "url deve ser https ou ssh"
      : typeof e.descricao !== "string" ? "descricao ausente"
      : e.versao !== undefined && typeof e.versao !== "string" ? "versao inválida"
      : seen.has(e.id) ? "id duplicado"
      : "";
    if (why) return warn(`catálogo: entrada ${i} descartada (${why})`);
    const ok = e as unknown as CatalogEntry;
    seen.add(ok.id);
    out.push({ id: ok.id, url: ok.url, descricao: ok.descricao, ...(ok.versao ? { versao: ok.versao } : {}) });
  });
  return out;
}

function readCache(warn: (m: string) => void, allowFile: boolean): { fetchedAt: number; modules: CatalogEntry[] } | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(), "utf8"));
    if (typeof c.fetchedAt !== "number") return null;
    return { fetchedAt: c.fetchedAt, modules: parseCatalog({ version: 1, modules: c.modules }, warn, allowFile) };
  } catch {
    return null;
  }
}

/** fresh cache → network → stale cache → embedded. Never throws; network failure is silent. */
export async function loadCatalog(opts: CatalogLoadOpts = {}): Promise<Catalog> {
  const warn = opts.warn ?? defaultWarn;
  const now = opts.now ?? Date.now();
  const cache = readCache(warn, Boolean(opts.allowFile));
  if (cache && now - cache.fetchedAt < CATALOG_TTL_MS) return { modules: cache.modules, source: "cache", fetchedAt: cache.fetchedAt };
  try {
    const res = await (opts.fetchImpl ?? fetch)(process.env.PVX_CATALOG_URL || DEFAULT_CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const modules = parseCatalog(await res.json(), warn, opts.allowFile);
    try {
      mkdirSync(pvxHome(), { recursive: true });
      writeFileSync(cachePath(), JSON.stringify({ fetchedAt: now, modules }));
    } catch {} // read-only PVX_HOME (no root): just skip the cache
    return { modules, source: "rede", fetchedAt: now };
  } catch {
    if (cache) return { modules: cache.modules, source: "cache antigo", fetchedAt: cache.fetchedAt };
    return { modules: parseCatalog(embedded, warn), source: "embutido" };
  }
}

/** Prefix matches first, then "contains"; id before descricao; ties keep catalog order. Empty term returns all. */
export function searchCatalog(cat: Pick<Catalog, "modules">, term: string): CatalogEntry[] {
  const t = term.trim().toLowerCase();
  if (!t) return cat.modules;
  const rank = (m: CatalogEntry) => {
    const id = m.id.toLowerCase();
    const d = m.descricao.toLowerCase();
    return id.startsWith(t) ? 0 : d.startsWith(t) ? 1 : id.includes(t) ? 2 : d.includes(t) ? 3 : 4;
  };
  return cat.modules
    .map((m, i) => ({ m, r: rank(m), i }))
    .filter((x) => x.r < 4)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.m);
}

const SHORT_RE = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;
export const MODULE_REF_FORMS = "use `usuario/repositorio` (GitHub), uma URL completa (https://…, ssh://… ou git@host:caminho) ou um id do catálogo";
const okName = (n: string) => !n.startsWith("-") && !n.includes("..") && n !== "." && n !== ".git";

/**
 * The repository a ref names: a URL is returned as is, `user/repo[.git]` means GitHub, a bare id is looked up in the catalog.
 * Throws a pt-BR Error listing the accepted forms (and close catalog matches).
 */
export async function resolveModuleRef(ref: string, opts: CatalogLoadOpts = {}): Promise<string> {
  return (await resolveRef(ref, opts)).url;
}

/** True when `url` is exactly an entry's URL (the same comparison the add's idempotency check makes on origins). */
export const catalogHas = (cat: Pick<Catalog, "modules">, url: string) => cat.modules.some((m) => m.url === url);

/** Whether `url` belongs to the official catalog (fresh cache, else the loader's own fallbacks). Never throws: any failure is "no". */
export async function isCatalogUrl(url: string, opts: CatalogLoadOpts = {}): Promise<boolean> {
  try {
    return catalogHas(await loadCatalog(opts), url);
  } catch {
    return false;
  }
}

/** Like `resolveModuleRef`, also telling whether the ref is from the catalog: a bare id, or a URL equal to an entry's. */
export async function resolveModuleRefInfo(ref: string, opts: CatalogLoadOpts = {}): Promise<{ url: string; catalog: boolean }> {
  const r = await resolveRef(ref, opts);
  return { url: r.url, catalog: r.catalog || (await isCatalogUrl(r.url, opts)) };
}

async function resolveRef(ref: string, opts: CatalogLoadOpts): Promise<{ url: string; catalog: boolean }> {
  if (isModuleUrl(ref)) return { url: ref, catalog: false };
  if (ref.includes("/")) {
    const m = SHORT_RE.exec(ref);
    const repo = m?.[2]!.replace(/\.git$/, "");
    if (!m || !repo || !okName(m[1]!) || !okName(repo)) throw new Error(`referência inválida "${ref}": ${MODULE_REF_FORMS}`);
    return { url: `https://github.com/${m[1]}/${repo}.git`, catalog: false };
  }
  const cat = await loadCatalog(opts);
  const hit = cat.modules.find((m) => m.id === ref);
  if (hit) return { url: hit.url, catalog: true };
  const close = searchCatalog(cat, ref).slice(0, 5).map((m) => m.id);
  throw new Error(`módulo "${ref}" não está no catálogo (${cat.source})${close.length ? `; parecidos: ${close.join(", ")}` : ""}; ${MODULE_REF_FORMS}`);
}

export const isInstalled = (id: string) => existsSync(join(usermodulesDir(), id));
