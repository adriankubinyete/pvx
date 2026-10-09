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

// Host code reaches a built-in by ROLE (`PageDef.role`, `ModuleDef.roles`), never by its id. The ids come from the
// manifests, so a new built-in is covered without editing this test. A bare id is not searched: `conformidade` is also a
// core command and `nota` is the diary's own kind and an ordinary word. What gives a reference away is its shape:
// `<id>.<name>` (page key, query, tab id), a command line of the module, or `motd` as a whole word (only ever a module).
function builtinRefs(): RegExp {
  const dirs = readdirSync(join(root, "packages", "builtin")).filter((n) => statSync(join(root, "packages", "builtin", n)).isDirectory());
  const manifests = dirs.map((d) => JSON.parse(readFileSync(join(root, "packages", "builtin", d, "pvx-module.json"), "utf8")) as { id: string; contributes?: { commands?: string[] } });
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ids = [...new Set([...manifests.map((m) => m.id), ...dirs])]; // `notas` (directory and query namespace) too
  const sep = "[\\s\"'`,]+";
  const patterns = [
    ...ids.map((id) => `(?:page:|["'\`])${esc(id)}\\.[a-z]`), // "nota.notas", "page:conformidade.plano", "notas.compose"
    ...manifests.flatMap((m) => m.contributes?.commands ?? []).map((c) => `(?<![\\w-])${c.split(" ").map(esc).join(sep)}(?![\\w-])`), // `nota add`, ["nota", "add"]
    "(?<![\\w-])motd(?![\\w-])",
  ];
  expect(ids).toEqual(expect.arrayContaining(["conformidade", "nota", "notas", "motd"]));
  return new RegExp(patterns.join("|"));
}

test("the host names no built-in module: only roles (core command names are not references)", () => {
  expect(grep(walk(join(root, "packages"), ["test", "builtin"]), builtinRefs())).toEqual([]);
});

test("the built-in check catches the references it exists for, and lets core command names through", () => {
  const re = builtinRefs();
  for (const bad of ['registry.pages.has("nota.notas")', 'goto("page:conformidade.plano")', 'query("notas.compose")', 'const argv = ["nota", "add"]', "run `nota add --ref x`", "motd install-hook"]) expect(re.test(bad), bad).toBe(true);
  for (const ok of ['key: "conformidade ignorar"', "conformidade.lines", 'kinds: ["nota"]', "a nota foi criada", "pvx plano apply"]) expect(re.test(ok), ok).toBe(false);
});
