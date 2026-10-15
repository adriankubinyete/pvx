import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@pvx/sdk";
import { createRegistry, loadModules, runCli, type CliIO } from "../../src/index.ts";

process.env.PVX_USERMODULES = join(import.meta.dir, "../fixtures/usermodules");
const profilesDir = join(import.meta.dir, "../fixtures/profiles");
const theme = { text: "#ffffff", accent: "#00ff00", ok: "#00ff00", warn: "#ffff00", error: "#ff0000", info: "#0000ff" };

const noop = () => {};
const makeLogger = (): Logger => ({ debug: noop, info: noop, warn: noop, error: noop });
const registry = createRegistry();
await loadModules(registry, { hostVersion: "1.0.0", makeLogger });

async function run(line: string, over: Partial<CliIO> = {}) {
  const out: string[] = [];
  const code = await runCli({
    argv: line.split(" ").filter(Boolean),
    env: { NO_COLOR: "1" },
    isTTY: false,
    isRoot: true,
    registry,
    makeLogger,
    profilesDir,
    version: "1.0.0",
    theme,
    out: (l) => out.push(l),
    ...over,
  });
  return { code, out, text: out.join("\n") };
}

describe("--json goldens: exact shape, nothing else on stdout", () => {
  const cases: [string, string, number][] = [
    ["success", "demo greet bob --json", 0],
    ["warning-only", "demo greet warn --json", 0],
    ["error", "demo greet bad --json", 1],
    ["usage", "demo greet --json", 2],
    ["not-found", "demo nope --json", 3],
    ["destructive-without-yes", "demo wipe --json", 2],
    ["modules-with-load-error", "modules --json", 0],
  ];
  for (const [name, line, exit] of cases) {
    test(name, async () => {
      const { code, out } = await run(line);
      expect(code).toBe(exit);
      expect(out).toHaveLength(1);
      const file = join(import.meta.dir, "golden", `${name}.json`);
      if (process.env.UPDATE_GOLDEN) writeFileSync(file, `${JSON.stringify(JSON.parse(out[0]!), null, 2)}\n`);
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(out[0]!)).toEqual(JSON.parse(readFileSync(file, "utf8")));
      expect(Object.keys(JSON.parse(out[0]!))).toEqual(["ok", "exit", "lines"]);
    });
  }
});

describe("text mode", () => {
  test("result lines use [glyph] text; plain lines are bare", async () => {
    expect((await run("demo greet warn")).out).toEqual(["[✓] oi warn", "[!] cuidado"]);
    expect((await run("demo greet bad")).out).toContain("[✗] falhou");
    expect((await run("version")).out).toEqual(["pvx 1.0.0"]);
  });
  test("color only with TTY and no NO_COLOR; the glyphs stay without color", async () => {
    const tty = { isTTY: true, ask: async () => "" };
    expect((await run("demo greet bob", { ...tty, env: {} })).text).toContain("\x1b[");
    expect((await run("demo greet bob", tty)).text).toBe("[✓] oi bob"); // NO_COLOR set
    expect((await run("demo greet bob", { env: {} })).text).toBe("[✓] oi bob"); // no TTY
  });
});

describe("help", () => {
  test("root lists core and module commands, marks destructive with !", async () => {
    const { code, text } = await run("demo --help");
    expect(code).toBe(0);
    expect(text).toContain("demo greet");
    expect(text).toMatch(/! demo wipe/);
    expect(text).not.toMatch(/! demo greet/);
    const root = (await run("--help")).text;
    expect(root).toContain("plano apply");
    expect(root).toContain("demo login");
    expect(root).toContain("no-entry"); // load errors are listed, not fatal
  });
  test("command help is generated from help + args", async () => {
    const { text } = await run("demo greet --help");
    expect(text).toContain("uso: pvx demo greet <who> [--shout]");
    expect(text).toContain("Name");
    expect((await run("demo nope --help")).code).toBe(3);
  });
  test("no args: help + exit 2 without TTY, signal to open the TUI with TTY", async () => {
    const r = await run("");
    expect(r.code).toBe(2);
    expect(r.text).toContain("uso: pvx");
    expect((await run("", { isTTY: true })).code).toBe("tui");
  });
});

describe("global flags at any position", () => {
  test("--json after the command and its args", async () => {
    const r = await run("demo greet bob --shout --json");
    expect(JSON.parse(r.text)).toMatchObject({ ok: true, lines: [{ kind: "success", text: "OI BOB" }] });
  });
  test("--yes after args confirms a destructive command", async () => {
    expect((await run("demo wipe --yes")).out).toEqual(["[✓] apagado"]);
    expect((await run("--yes demo wipe")).out).toEqual(["[✓] apagado"]);
  });
  test("--help after a path shows that path's help", async () => {
    const r = await run("demo greet --help");
    expect(r.code).toBe(0);
    expect(r.text).toContain("uso: pvx demo greet");
    expect((await run("demo greet -h")).text).toContain("uso: pvx demo greet");
  });
  test("a declared arg of the same name is left to the command; `--` ends the global flags", async () => {
    expect((await run("demo echo --json")).out).toEqual(["[✓] json=true"]);
    const r = await run("demo greet -- --json");
    expect(r.out.join("")).not.toContain('"ok"');
  });
});

describe("destructive, secrets and root", () => {
  test("--yes runs it; a TTY asks s/N", async () => {
    expect((await run("demo wipe --yes")).out).toEqual(["[✓] apagado"]);
    const asked: string[] = [];
    const yes = await run("demo wipe", { isTTY: true, ask: async (q) => (asked.push(q), "s") });
    expect(yes.out).toEqual(["[✓] apagado"]);
    expect(asked[0]).toContain("[s/N]");
    const no = await run("demo wipe", { isTTY: true, ask: async () => "" });
    expect(no.code).toBe(1);
    expect(no.text).not.toContain("apagado");
  });
  test("a secret prompted on a TTY is used and never printed", async () => {
    const r = await run("demo login", { isTTY: true, ask: async () => "", askSecret: async () => "hunter2-secret" });
    expect(r.out).toEqual(["[✓] token com 14 chars"]);
    expect(r.text).not.toContain("hunter2");
    // no TTY, no env: exit 2 telling what to pass
    const none = await run("demo login");
    expect(none.code).toBe(2);
    expect(none.text).toContain("--token");
  });
  test("module commands and plano apply need root; read-only core commands do not", async () => {
    const r = await run("demo greet bob", { isRoot: false });
    expect(r.code).toBe(1);
    expect(r.text).toContain("rode com sudo");
    expect((await run("plano apply --yes", { isRoot: false })).text).toContain("rode com sudo");
    expect((await run("modules", { isRoot: false })).code).toBe(0);
    expect((await run("plano", { isRoot: false })).code).toBe(0);
  });
});

describe("core commands", () => {
  test("modules lists state and the load error text", async () => {
    const { text } = await run("modules");
    expect(text).toContain("demo 1.0.0 carregado");
    expect(text).toContain('[!] no-entry erro: manifest inválido: campo "entry" ausente');
  });
  test("conformidade prints per-capability lines and a summary; --strict exits 1 on pending", async () => {
    const r = await run("conformidade");
    expect(r.code).toBe(0);
    expect(r.out).toContain("[✓] fine: em ordem");
    expect(r.out).toContain("[✗] cap-fixture.a: pendente");
    expect(r.out.at(-1)).toBe("[i] 1 ok, 1 avisos, 3 erros");
    expect((await run("conformidade --strict")).code).toBe(1);
    expect((await run("conformidade --strict", { env: { PVX_PROFILE: "clean" } })).code).toBe(0);
  });
  test("conformidade: forced unknown profile is a usage error; no profile is a warning", async () => {
    const bad = await run("conformidade", { env: { PVX_PROFILE: "nope" } });
    expect(bad.code).toBe(2);
    expect(bad.text).toContain("main");
    const none = await run("conformidade", { profilesDir: "/nonexistent" });
    expect(none.code).toBe(0);
    expect(none.text).toContain("nenhum perfil");
  });
  test("plano lists steps and manual items", async () => {
    const { out } = await run("plano");
    expect(out.slice(0, 3)).toEqual(["1. cap-fixture fix-a para cap-fixture.a", "2. cap-fixture fix-b para cap-fixture.b", "3. cap-fixture fix-c para cap-fixture.c"]);
    expect(out.at(-1)).toBe("[!] manual: manual: sem fix");
  });
  test("plano apply --yes stops at the first error; steps after it never run", async () => {
    const r = await run("plano apply --yes");
    expect(r.code).toBe(1);
    expect(r.text).toContain("a aplicado");
    expect(r.text).toContain("b falhou");
    expect(r.text).not.toContain("c aplicado");
    expect(r.text).toContain("parou em `cap-fixture fix-b`");
  });
  test("plano apply without TTY requires --yes; with TTY confirms per step (s apply, p skip, n stop)", async () => {
    expect((await run("plano apply")).code).toBe(2);
    const answers = ["s", "p", "n"];
    const r = await run("plano apply", { isTTY: true, ask: async () => answers.shift()! });
    expect(r.code).toBe(0);
    expect(r.text).toContain("a aplicado");
    expect(r.text).not.toContain("b falhou");
    expect(r.text).not.toContain("c aplicado");
  });
  test("logs shows what a command logged", async () => {
    const real = (name: string): Logger => {
      const { createLogger, logsDir } = require("../../src/index.ts");
      return createLogger(logsDir(), name);
    };
    await run("demo greet bob", { makeLogger: real });
    const r = await run("logs demo --tail 5");
    expect(r.text).toContain('INFO demo: run demo greet {"who":"bob"}');
    expect((await run("logs --tail x")).code).toBe(2);
    expect((await run("logs ../../etc/x")).code).toBe(2); // module name must not escape logsDir
  });
});
