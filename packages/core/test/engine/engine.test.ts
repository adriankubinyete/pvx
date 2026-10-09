import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@pvx/sdk";
import { execute } from "../../src/engine/execute.ts";
import { loadModules } from "../../src/engine/loader.ts";
import { createRegistry } from "../../src/engine/registry.ts";
import { tokenize } from "../../src/engine/tokenize.ts";

process.env.PVX_USERMODULES = join(import.meta.dir, "../fixtures/usermodules");

const logs: Record<string, string[]> = {};
const makeLogger = (name: string): Logger => {
  const w = (lvl: string) => (m: string) => void (logs[name] ??= []).push(`${lvl} ${m}`);
  return { debug: w("DEBUG"), info: w("INFO"), warn: w("WARN"), error: w("ERROR") };
};
const load = async () => {
  const registry = createRegistry();
  await loadModules(registry, { hostVersion: "1.0.0", makeLogger });
  return registry;
};
const run = async (line: string, extra = {}) => execute(await load(), line, { makeLogger, ...extra });

describe("loader", () => {
  test("load errors are isolated per module, with clear messages; inapplicable is silent", async () => {
    const r = await load();
    const err = Object.fromEntries(r.errors.map((e) => [e.id, e.error]));
    expect(err["no-entry"]).toBe('manifest inválido: campo "entry" ausente');
    expect(err["no-default"]).toContain("export default");
    expect(err["throws-on-load"]).toBe("boom na fábrica");
    expect(err["broken-entry"]).toContain("fora do diretório");
    expect(err["bad-range"]).toContain(">=99.0.0");
    expect(err["not-applicable"]).toBeUndefined();
    expect(r.modules.has("not-applicable")).toBe(false);
    expect(r.modules.has("demo")).toBe(true); // others still loaded
  });

  test("loading does no work: twice leaves PVX_HOME untouched", async () => {
    await load();
    await load();
    expect(readdirSync(process.env.PVX_HOME!)).toEqual([]);
  });

  test("duplicate module id is refused naming both; unknown query is a clear error", async () => {
    const r = await load();
    expect(() => r.register({ id: "demo", version: "1", entry: "x" }, {})).toThrow("já registrado");
    const other = { id: "other", version: "1", entry: "x" };
    expect(() => r.register(other, { queries: { "demo.status": () => 1 } })).toThrow(/"demo".*"other"/);
    expect(() => r.query("nope.x")).toThrow("consulta desconhecida");
    expect(r.query("demo.status")).toBe("ready");
  });
});

describe("tokenize", () => {
  test("quotes and escapes", () => {
    expect(tokenize(`a "b c" 'd "e"' f\\ g "" "x\\"y"`)).toEqual(["a", "b c", 'd "e"', "f g", "", 'x"y']);
    expect(() => tokenize(`a "b`)).toThrow("aspas");
  });
});

describe("execute", () => {
  test("exit codes 0/1/2/3 and warnings do not fail", async () => {
    expect((await run("demo greet ana --shout")).lines).toEqual([{ kind: "success", text: "OI ANA" }]);
    expect((await run("demo greet warn")).exit).toBe(0);
    expect((await run("demo greet bad")).exit).toBe(1);
    const usage = await run("demo greet");
    expect(usage.exit).toBe(2);
    expect(usage.lines[0]!.text).toContain("falta o argumento `<who>`");
    expect((await run("demo greet a --nope")).exit).toBe(2);
    expect((await run("demo nada")).exit).toBe(3);
  });

  test("a throw in run gives exit 1, stack only in module log, and the session continues", async () => {
    const r = await load();
    const res = await execute(r, ["throws-on-run", "crash"], { makeLogger });
    expect(res.exit).toBe(1);
    expect(res.lines).toEqual([{ kind: "error", text: "erro interno no comando: kaboom" }]);
    expect(logs["throws-on-run"]!.join("\n")).toContain("at ");
    expect((await execute(r, "demo greet ana", { makeLogger })).exit).toBe(0);
  });

  test("destructive needs confirmation", async () => {
    const no = await run("demo wipe");
    expect(no.exit).toBe(2);
    expect(no.lines[0]!.text).toContain("--yes");
    expect((await run("demo wipe", { confirmed: true })).exit).toBe(0);
  });

  test("secrets: refused on argv, accepted from env/stdin, never in masked view or log", async () => {
    expect((await run("demo login --token=s3cret")).exit).toBe(2);
    const env = await run("demo login", { env: { PVX_SECRET_TOKEN: "s3cret" } });
    const stdin = await run("demo login --token-stdin", { env: {}, readStdin: async () => "s3cret\n" });
    for (const res of [env, stdin]) {
      expect(res.lines[0]!.text).toBe("token com 6 chars");
      expect(JSON.stringify(res.masked)).not.toContain("s3cret");
    }
    expect(env.masked).toEqual({ token: "***" });
    expect((await run("demo login s3cret")).lines[0]!.text).not.toContain("s3cret"); // stray value is not echoed
    expect(JSON.stringify(logs)).not.toContain("s3cret");
    const missing = await run("demo login", { env: {} });
    expect(missing.exit).toBe(2);
  });

  test("store is lazy: nothing on disk until set", async () => {
    await run("demo greet ana");
    expect(readdirSync(process.env.PVX_HOME!)).toEqual([]);
    await run("demo remember");
    expect(await Bun.file(join(process.env.PVX_HOME!, "modules/demo/state/state.json")).json()).toEqual({ k: 1 });
  });
});
