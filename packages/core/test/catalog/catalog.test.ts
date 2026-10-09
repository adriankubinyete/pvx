import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_TTL_MS, loadCatalog, parseCatalog, resolveModuleRef, searchCatalog } from "../../src/catalog/index.ts";
import { catalogSearchCommand } from "../../src/catalog/search-command.ts";

const good = { id: "redes", url: "https://x.com/redes.git", descricao: "Diagnóstico de rede", versao: "1.0.0" };
const body = { version: 1, modules: [good, { id: "dns", url: "ssh://git@x.com/dns.git", descricao: "Ferramentas de DNS" }] };
const f = (fn: () => Promise<Response>) => fn as unknown as typeof fetch;
const ok = f(() => Promise.resolve(Response.json(body)));
const down = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
const quiet = { warn: () => {} };
let calls = 0;
const counting = f(() => (calls++, Promise.resolve(Response.json(body))));

test("network, then fresh cache without fetch, then stale refetch", async () => {
  calls = 0;
  const t0 = 1_000_000;
  expect((await loadCatalog({ fetchImpl: counting, now: t0, ...quiet })).source).toBe("rede");
  const c = await loadCatalog({ fetchImpl: counting, now: t0 + 1000, ...quiet });
  expect(c.source).toBe("cache");
  expect(c.modules).toHaveLength(2);
  expect(calls).toBe(1);
  expect((await loadCatalog({ fetchImpl: counting, now: t0 + CATALOG_TTL_MS + 1, ...quiet })).source).toBe("rede");
  expect(calls).toBe(2);
});

test("network down: stale cache, then embedded", async () => {
  expect((await loadCatalog({ fetchImpl: down, now: 5, ...quiet })).source).toBe("embutido");
  await loadCatalog({ fetchImpl: ok, now: 5, ...quiet });
  const c = await loadCatalog({ fetchImpl: down, now: 5 + CATALOG_TTL_MS, ...quiet });
  expect(c.source).toBe("cache antigo");
  expect(c.modules).toHaveLength(2);
});

test("real local server, PVX_CATALOG_URL and HTTP error", async () => {
  const srv = Bun.serve({ port: 0, fetch: (r) => (new URL(r.url).pathname === "/c.json" ? Response.json(body) : new Response("no", { status: 500 })) });
  try {
    process.env.PVX_CATALOG_URL = `http://localhost:${srv.port}/c.json`;
    expect((await loadCatalog({ now: 1, ...quiet })).source).toBe("rede");
    process.env.PVX_CATALOG_URL = `http://localhost:${srv.port}/bad`;
    expect((await loadCatalog({ now: 1 + CATALOG_TTL_MS, ...quiet })).source).toBe("cache antigo");
  } finally {
    delete process.env.PVX_CATALOG_URL;
    srv.stop(true);
  }
});

test("invalid entries are dropped with warnings, never a crash", () => {
  const w: string[] = [];
  const bad = [good, { ...good, id: "Bad_ID" }, { ...good, id: "a", url: "http://x.com/a" }, { ...good, id: "b", url: "file:///x" }, { ...good }, 7, null, { id: "c" }];
  expect(parseCatalog({ version: 1, modules: bad }, (m) => w.push(m)).map((m) => m.id)).toEqual(["redes"]);
  expect(w).toHaveLength(7);
  expect(parseCatalog("lixo", (m) => w.push(m))).toEqual([]);
  expect(parseCatalog({ version: 2, modules: [] }, () => {})).toEqual([]);
});

test("search ranks prefix before contains, id before descricao", () => {
  const mk = (id: string, descricao: string) => ({ id, url: "https://x/y", descricao });
  const cat = { modules: [mk("zeta", "usa rede"), mk("minha-rede", "x"), mk("rede-x", "x"), mk("alfa", "rede aqui"), mk("nada", "nada")] };
  expect(searchCatalog(cat, "rede").map((m) => m.id)).toEqual(["rede-x", "alfa", "minha-rede", "zeta"]);
  expect(searchCatalog(cat, "")).toHaveLength(5);
});

test("resolveModuleRef: url passthrough, id, unknown with suggestions", async () => {
  const opts = { fetchImpl: ok, now: 1, ...quiet };
  expect(await resolveModuleRef("https://a.b/c.git", { fetchImpl: down })).toBe("https://a.b/c.git");
  expect(await resolveModuleRef("git@a.b:c/d.git", { fetchImpl: down })).toBe("git@a.b:c/d.git");
  expect(await resolveModuleRef("dns", opts)).toBe("ssh://git@x.com/dns.git");
  await expect(resolveModuleRef("red", opts)).rejects.toThrow(/parecidos: redes/);
  await expect(resolveModuleRef("zzz", opts)).rejects.toThrow(/não está no catálogo/);
});

test("modules search --json shape and installed mark", async () => {
  await loadCatalog({ fetchImpl: ok, ...quiet }); // fresh cache for the command
  const home = process.env.PVX_HOME!;
  process.env.PVX_USERMODULES = join(home, "usermodules"); // other test files set it process-wide
  mkdirSync(join(home, "usermodules", "dns"), { recursive: true });
  const lines: { text: string }[] = [];
  const o = { line: (l: { text: string }) => void lines.push(l), finish: (n: number) => n };
  const run = (rest: string[], json: boolean) => catalogSearchCommand.run({ io: {} as never, o, rest, json });
  expect(await run(["d"], true)).toBe(0);
  const j = JSON.parse(lines[0]!.text);
  expect(j.source).toBe("cache");
  expect(j.modules.map((m: { id: string; installed: boolean }) => [m.id, m.installed])).toEqual([["dns", true], ["redes", false]]);
  expect(Object.keys(j.modules[1]).sort()).toEqual(["descricao", "id", "installed", "url", "versao"]);
  lines.length = 0;
  await run([], false);
  expect(lines[1]!.text).toBe("✓ dns  Ferramentas de DNS");
  expect(lines.at(-1)!.text).toStartWith("fonte: cache");
});
