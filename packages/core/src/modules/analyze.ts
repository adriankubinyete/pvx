import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RULES: [RegExp, string][] = [
  [/\bchild_process\b/, "usa child_process"],
  [/\bBun\.spawn(Sync)?\b/, "usa Bun.spawn"],
  [/\bBun\.\$/, "usa Bun.$"],
  [/\bBun\.write\s*\(/, "escreve arquivo com Bun.write"],
  [/(?<![\w.])fetch\s*\(/, "chama fetch( direto"],
];
const FS_IMPORT = /["'](node:)?fs(\/promises)?["']/;
const FS_WRITE = /\b(writeFile|appendFile|createWriteStream|rm|unlink|mkdir|rename|copyFile)(Sync)?\s*\(/;
const MAX = 40;

export interface Hit {
  /** Posix path relative to the module dir. */
  file: string;
  line: number;
  msg: string;
}
export interface Source {
  /** Posix path relative to the module dir. */
  path: string;
  src: string;
}

function walk(dir: string, rel: string): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    if (e.name === ".git" || e.name === "node_modules" || e.isSymbolicLink()) return [];
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, p) : /\.(tsx?|jsx?|mjs|cjs)$/.test(e.name) ? [p] : [];
  });
}

/** Code files of a checkout, sorted, with forward-slash paths on every OS. Files over 1 MB are left out. */
export function readSources(dir: string): Source[] {
  return walk(dir, "")
    .sort()
    .filter((p) => statSync(join(dir, p)).size <= 1_000_000)
    .map((path) => ({ path, src: readFileSync(join(dir, path), "utf8") }));
}

/** Static scan for APIs that bypass ctx.exec/net/fs. A warning for the reviewer, not a guarantee (the module is not sandboxed). */
export function analyze(dir: string, sources: Source[] = readSources(dir)): Hit[] {
  const out: Hit[] = [];
  for (const { path, src } of sources) {
    const usesFs = FS_IMPORT.test(src);
    src.split("\n").forEach((line, i) => {
      const msgs = RULES.filter(([re]) => re.test(line)).map(([, m]) => m);
      if (usesFs && FS_WRITE.test(line)) msgs.push("escreve com node:fs");
      for (const msg of msgs) out.push({ file: path, line: i + 1, msg });
    });
  }
  return out;
}

/** The hits as `path:line: msg` text, capped. */
export function hitLines(hits: Hit[]): string[] {
  const all = hits.map((h) => `${h.file}:${h.line}: ${h.msg}`);
  return all.length > MAX ? [...all.slice(0, MAX), `... e mais ${all.length - MAX}`] : all;
}
