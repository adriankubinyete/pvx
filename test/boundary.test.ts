import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** Every source file under dir, skipping node_modules and the given directory names. */
function walk(dir: string, skip: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || skip.includes(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, skip) : /\.(tsx?|json)$/.test(n) ? [p] : [];
  });
}

const grep = (files: string[], re: RegExp) =>
  files.flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((l, i) => (re.test(l) ? [`${f.slice(root.length + 1)}:${i + 1}: ${l.trim()}`] : [])));

// `packages/builtin` is module code (it ships official modules), so the host rule does not apply to it. The host's own
// words are a different matter: `conformidade` is also a core command, so it is not in the id list.
test("the host knows no module: no fixture id and no real module name in packages/ sources", () => {
  const ids = ["demo", "bad-range", "broken-entry", "no-default", "no-entry", "not-applicable", "throws-on-load", "throws-on-run", "cap-fixture", "echoer", "ui-demo"];
  const real = ["firewall", "ssl", "autobackup", "zabbix", "autobloqueador", "ssh-hardening"];
  const re = new RegExp(`(?<![\\w-])(${[...ids, ...real].join("|")})(?![\\w-])`, "i");
  expect(grep(walk(join(root, "packages"), ["test", "builtin"]), re)).toEqual([]);
});

test("process.exit only in apps/pvx/src/index.ts", () => {
  const files = [...walk(join(root, "packages"), []), ...walk(join(root, "apps"), [])].filter((f) => !f.endsWith(join("apps", "pvx", "src", "index.ts")));
  expect(grep(files, /process\.exit\(/)).toEqual([]);
});

test("built-in modules are written like usermodules: only `import type` from the SDK, relative imports otherwise, classic JSX", () => {
  const files = walk(join(root, "packages", "builtin"), []).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(join("builtin", "index.ts")));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const bad = [...src.matchAll(/^import\s+(?!type\b)[^"']*["']([^"']+)["']|^import\s+type\s[^"']*["']([^"']+)["']/gm)].filter((m) => (m[1] ? !m[1].startsWith(".") : m[2] !== "@pvx/sdk" && !m[2]!.startsWith(".")));
    expect(bad.map((m) => m[0]), f).toEqual([]);
    if (f.endsWith(".tsx")) expect(src, f).toContain("@jsxRuntime classic");
  }
});
