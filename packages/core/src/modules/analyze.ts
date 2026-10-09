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

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === ".git" || e.name === "node_modules" || e.isSymbolicLink()) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(tsx?|jsx?|mjs|cjs)$/.test(e.name) ? [p] : [];
  });
}

/** Static scan for APIs that bypass ctx.exec/net/fs. A warning for the reviewer, not a guarantee (the module is not sandboxed). */
export function analyze(dir: string): string[] {
  const out: string[] = [];
  for (const f of files(dir)) {
    if (statSync(f).size > 1_000_000) continue;
    const src = readFileSync(f, "utf8");
    const usesFs = FS_IMPORT.test(src);
    src.split("\n").forEach((line, i) => {
      const hits = RULES.filter(([re]) => re.test(line)).map(([, m]) => m);
      if (usesFs && FS_WRITE.test(line)) hits.push("escreve com node:fs");
      for (const h of hits) out.push(`${f.slice(dir.length + 1)}:${i + 1}: ${h}`);
    });
  }
  return out.length > MAX ? [...out.slice(0, MAX), `... e mais ${out.length - MAX}`] : out;
}
