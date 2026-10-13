import { posix } from "node:path";
import type { Hit, Source } from "./analyze.ts";

export interface ReviewFile {
  /** Posix path relative to the module dir. */
  path: string;
  lines: number;
  /** First path segment plus "/", or "." for files at the root. */
  group: string;
  /** The manifest entry. */
  entry: boolean;
  /** Reachable from the entry through relative imports. */
  used: boolean;
  /** Relative paths of the files that import this one. */
  importedBy: string[];
  /** Static analysis hits in this file. */
  hits: { line: number; msg: string }[];
}

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
// from "x" (import/export), side-effect import "x", import("x"), require("x"); only relative specifiers
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])(\.{1,2}(?:\/[^"'\n]*)?)\1/g;

const countLines = (s: string) => (s ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0);
const groupOf = (p: string) => (p.includes("/") ? `${p.slice(0, p.indexOf("/"))}/` : ".");

function resolve(from: string, spec: string, known: Set<string>): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  // TS projects write "./a.js" for a.ts
  const swapped = base.replace(/\.(m|c)?jsx?$/, "");
  const tries = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)];
  if (swapped !== base) tries.push(...EXTS.map((e) => swapped + e));
  return tries.find((t) => known.has(t));
}

/** One row per code file: size, group, import graph from `entry`, and the analysis hits. Sorted for display. */
export function buildFiles(sources: Source[], entry: string, hits: Hit[]): ReviewFile[] {
  const known = new Set(sources.map((s) => s.path));
  const root = posix.normalize(entry.replaceAll("\\", "/"));
  const imports = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();
  for (const { path, src } of sources) {
    const out = new Set<string>();
    for (const m of src.matchAll(SPEC)) {
      const to = resolve(path, m[2]!, known);
      if (!to || to === path) continue;
      out.add(to);
      (importedBy.get(to) ?? importedBy.set(to, new Set()).get(to)!).add(path);
    }
    imports.set(path, out);
  }
  const used = new Set<string>();
  const queue = known.has(root) ? [root] : [];
  for (const p of queue) {
    if (used.has(p)) continue;
    used.add(p);
    queue.push(...(imports.get(p) ?? []));
  }
  const files = sources.map<ReviewFile>(({ path, src }) => ({
    path,
    lines: countLines(src),
    group: groupOf(path),
    entry: path === root,
    used: used.has(path),
    importedBy: [...(importedBy.get(path) ?? [])].sort(),
    hits: hits.filter((h) => h.file === path).map(({ line, msg }) => ({ line, msg })),
  }));
  const first = groupOf(root);
  const rank = (g: string) => (g === first ? 0 : 1);
  return files.sort((a, b) => rank(a.group) - rank(b.group) || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) || b.lines - a.lines || (a.path < b.path ? -1 : 1));
}
