import { describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@pvx/sdk";
import { activeIgnores, addIgnore, auditLogin, createRegistry, diary, driftOf, execute, lastSeen, markSeen, novidades, parseSince, pvxHome, runCli, type CliIO, type Registry } from "../../src/index.ts";
import { appendJsonl, readJsonl } from "../../src/diary/jsonl.ts";

const noop = () => {};
const makeLogger = (): Logger => ({ debug: noop, info: noop, warn: noop, error: noop });
const theme = { text: "#fff", accent: "#0f0", warn: "#ff0", error: "#f00", info: "#00f" };
const lines = (file: string) => (existsSync(join(pvxHome(), file)) ? readFileSync(join(pvxHome(), file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

let level: "ok" | "warn" | "error" = "ok";
const notes: string[][] = [];
function build(withNotas = false): Registry {
  const r = createRegistry();
  r.register(
    { id: "t", version: "1", entry: "x" },
    {
      commands: {
        read: { help: "h", run: (c) => c.out.success("lido") },
        wipe: { help: "h", destructive: true, run: (c) => c.out.success("apagado") },
        login: { help: "h", args: [{ name: "token", help: "t", kind: "option", secret: true }], run: (c) => c.out.success("ok") },
      },
      capabilities: [{ id: "t.cap", title: "cap", goal: "g", fix: "t read", prove: () => ({ level, text: `nível ${level}` }) }],
    },
  );
  if (withNotas) r.register({ id: "nota", version: "1", entry: "x" }, { commands: { add: { help: "h", args: [{ name: "tag", help: "", kind: "option" }, { name: "ref", help: "", kind: "option" }, { name: "text", help: "", kind: "positional" }], run: (c) => void notes.push([String(c.args.tag), String(c.args.ref), String(c.args.text)]) } } });
  return r;
}
const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};

describe("audit log", () => {
  test("default scope: destructive commands only; PVX_AUDIT=all records everything; one line per event", async () => {
    const r = build();
    await withEnv({ SUDO_USER: "ana" }, async () => {
      await execute(r, "t read", { makeLogger });
      await execute(r, "t wipe", { makeLogger, confirmed: true });
      expect(lines("audit.jsonl")).toHaveLength(1);
      expect(lines("audit.jsonl")[0]).toMatchObject({ v: 1, kind: "cmd", user: "ana", line: "t wipe", exit: 0, destructive: true });
      expect(typeof lines("audit.jsonl")[0].ms).toBe("number");
      await withEnv({ PVX_AUDIT: "all" }, async () => {
        await execute(r, "t read", { makeLogger });
      });
      expect(lines("audit.jsonl").map((l) => l.line)).toEqual(["t wipe", "t read"]);
      expect(readFileSync(join(pvxHome(), "audit.jsonl"), "utf8").split("\n")).toHaveLength(3); // two lines + the final newline
    });
  });

  test("a refused destructive command is not recorded (it did not run); a failing one records exit 1", async () => {
    const r = build();
    await execute(r, "t wipe", { makeLogger });
    expect(lines("audit.jsonl")).toHaveLength(0);
  });

  test("secrets never appear: refused in argv, and a secret from the environment is not in the line", async () => {
    const r = build();
    await withEnv({ PVX_AUDIT: "all", PVX_SECRET_TOKEN: "hunter2zz" }, async () => {
      expect((await execute(r, "t login --token hunter2zz", { makeLogger })).ok).toBe(false);
      expect((await execute(r, "t login", { makeLogger })).ok).toBe(true);
    });
    const raw = readFileSync(join(pvxHome(), "audit.jsonl"), "utf8");
    expect(raw).not.toContain("hunter2zz");
    expect(lines("audit.jsonl").map((l) => l.line)).toEqual(["t login"]);
  });

  test("core mutations are recorded by default, core reads only with PVX_AUDIT=all", async () => {
    const io = (argv: string[]): CliIO => ({ argv, env: { NO_COLOR: "1" }, isTTY: false, isRoot: true, registry: build(), makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "1", theme, out: noop });
    await runCli(io(["modules", "enable", "ghost"]));
    await runCli(io(["version"]));
    expect(lines("audit.jsonl").map((l) => l.line)).toEqual(["modules enable ghost"]);
  });

  test("logins and module events share the file; rotation keeps 3 backups and reading spans them", () => {
    auditLogin("ana", "203.0.113.50");
    expect(lines("audit.jsonl")[0]).toMatchObject({ kind: "login", user: "ana", from: "203.0.113.50" });
    const f = join(pvxHome(), "rot.jsonl");
    for (let i = 0; i < 6; i++) appendJsonl(f, { at: new Date(1000 + i).toISOString(), i }, 40);
    expect(existsSync(`${f}.3`)).toBe(true);
    expect(existsSync(`${f}.4`)).toBe(false);
    const all = readJsonl<{ at: string; i: number }>(f).map((e) => e.i);
    expect(all).toEqual([...all].sort((a, b) => b - a)); // newest first across the backups
    expect(all[0]).toBe(5);
  });
});

describe("drift", () => {
  const profilesDir = () => join(pvxHome(), "profiles");
  const evaluate = async (registry: Registry) => {
    mkdirSync(profilesDir(), { recursive: true });
    writeFileSync(join(profilesDir(), "10.json"), JSON.stringify({ id: "p", title: "P", requires: ["t.cap"] }));
    await runCli({ argv: ["conformidade"], env: { NO_COLOR: "1" }, isTTY: false, isRoot: false, registry, makeLogger, profilesDir: profilesDir(), version: "1", theme, out: noop });
  };

  test("only changes are appended; the first sight sets the baseline", async () => {
    const r = build();
    level = "ok";
    await evaluate(r);
    await evaluate(r);
    expect(lines("conformity.jsonl")).toHaveLength(0);
    level = "error";
    await evaluate(r);
    await evaluate(r);
    expect(lines("conformity.jsonl")).toEqual([expect.objectContaining({ v: 1, id: "t.cap", from: "ok", to: "error", text: "nível error" })]);
    level = "ok";
    await evaluate(r);
    expect(lines("conformity.jsonl")).toHaveLength(2);
    expect(driftOf("t.cap")).toMatchObject({ from: "error", to: "ok", worse: false });
    expect(driftOf("t.cap")!.label).toMatch(/^melhorou hoje \d\d:\d\d$/);
    expect(driftOf("nada")).toBeUndefined();
  });
});

describe("ignore", () => {
  const T0 = Date.parse("2026-10-09T10:00:00Z");
  test("lasts 24 h on an injected clock; a second ignore replaces the first", () => {
    addIgnore("t.cap", "janela de manutenção", T0, "ana");
    expect(activeIgnores(T0 + 23 * 3600e3)).toEqual([{ id: "t.cap", until: new Date(T0 + 24 * 3600e3).toISOString(), reason: "janela de manutenção", author: "ana" }]);
    expect(activeIgnores(T0 + 24 * 3600e3)).toEqual([]);
    addIgnore("t.cap", "outro", T0 + 3600e3, "rafael");
    expect(activeIgnores(T0 + 3600e3)).toHaveLength(1);
  });

  const io = (argv: string[], registry: Registry, out: string[]): CliIO => ({ argv, env: { NO_COLOR: "1" }, isTTY: false, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "1", theme, out: (l) => void out.push(l) });
  const setup = () => {
    mkdirSync(join(pvxHome(), "profiles"), { recursive: true });
    writeFileSync(join(pvxHome(), "profiles", "10.json"), JSON.stringify({ id: "p", title: "P", requires: ["t.cap"] }));
    level = "error";
  };

  test("`conformidade ignorar` creates the note through `nota add` and takes the item out of the plan", async () => {
    setup();
    notes.length = 0;
    const r = build(true);
    const out: string[] = [];
    expect(await runCli(io(["conformidade", "ignorar", "t.cap", "--motivo", "cliente pediu"], r, out))).toBe(0);
    expect(notes).toEqual([["ignorado", "cap:t.cap", "cliente pediu"]]);
    expect(activeIgnores()[0]).toMatchObject({ id: "t.cap", reason: "cliente pediu" });
    const plan: string[] = [];
    await runCli(io(["plano"], r, plan));
    expect(plan.join("\n")).toContain("ignorado até");
    expect(plan.join("\n")).not.toContain("1. t read");
    const conf: string[] = [];
    await runCli(io(["conformidade", "--strict"], r, conf));
    expect(conf.join("\n")).toMatch(/ignorado até \d\d:\d\d/);
    expect(await runCli(io(["conformidade", "--strict"], r, []))).toBe(0);
  });

  test("without the notas module it warns and keeps the reason; unknown capability and missing reason are usage errors", async () => {
    setup();
    const out: string[] = [];
    expect(await runCli(io(["conformidade", "ignorar", "t.cap", "--motivo", "x"], build(), out))).toBe(0);
    expect(out.join("\n")).toContain("módulo de notas não carregado");
    expect(activeIgnores()[0]!.reason).toBe("x");
    expect(await runCli(io(["conformidade", "ignorar", "nope", "--motivo", "x"], build(), []))).toBe(2);
    expect(await runCli(io(["conformidade", "ignorar", "t.cap"], build(), []))).toBe(2);
  });
});

describe("diary", () => {
  const at = (n: number) => new Date(Date.parse("2026-10-09T09:00:00Z") + n * 60000).toISOString();
  function fixtures() {
    const put = (f: string, ...ev: object[]) => appendFileSync(join(pvxHome(), f), ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
    put("notes.jsonl", { v: 1, id: "n1", at: at(1), ev: "add", author: "ana", text: "não reiniciar o asterisk", tags: ["aviso"], ref: "cap:t.cap" }, { v: 1, id: "n1", at: at(6), ev: "pin", author: "carlos" });
    put("audit.jsonl",
      { v: 1, at: at(2), kind: "cmd", user: "carlos", line: "firewall apply", exit: 0, ms: 40, destructive: true },
      { v: 1, at: at(4), kind: "login", user: "ana", from: "203.0.113.50" },
      { v: 1, at: at(5), kind: "module", user: "rafael", text: "trust aprovado: x abc" },
    );
    put("conformity.jsonl", { v: 1, at: at(3), id: "t.cap", from: "ok", to: "error", text: "IP fora da whitelist" });
  }

  test("merges the five sources in order and filters by kind", () => {
    fixtures();
    const all = diary.query();
    expect(all.map((e) => e.kind)).toEqual(["nota", "module", "login", "conf", "cmd", "nota"]);
    expect(all.map((e) => e.at)).toEqual([at(6), at(5), at(4), at(3), at(2), at(1)]);
    expect(diary.query({ kinds: ["cmd", "conf"] }).map((e) => e.kind)).toEqual(["conf", "cmd"]);
    expect(diary.query({ kinds: ["login"] })[0]).toMatchObject({ user: "ana", text: "SSH de 203.0.113.50" });
    expect(diary.query({ kinds: ["nota"] }).map((e) => e.ref)).toEqual(["nota:n1", "nota:n1"]);
    expect(diary.query({ kinds: ["conf"] })[0]!.ref).toBe("cap:t.cap");
  });

  test("filters by text, user and since", () => {
    fixtures();
    expect(diary.query({ text: "ASTERISK" })).toHaveLength(1);
    expect(diary.query({ user: "ana" }).map((e) => e.kind)).toEqual(["login", "nota"]);
    expect(diary.query({ since: at(4) }).map((e) => e.at)).toEqual([at(6), at(5), at(4)]);
    expect(diary.query({ since: "1h" }, Date.parse(at(200))).length).toBe(0);
    expect(parseSince("24h", 86400000 * 3)).toBe(86400000 * 2);
    expect(() => parseSince("ontem")).toThrow("instante inválido");
  });

  test("`since` stops reading early: a huge old tail is never parsed", () => {
    const f = join(pvxHome(), "audit.jsonl");
    writeFileSync(f, `${JSON.stringify({ v: 1, at: at(0), kind: "cmd", user: "a", line: "old", exit: 0, ms: 1, destructive: true })}\n`.repeat(20000));
    appendFileSync(f, `${JSON.stringify({ v: 1, at: at(100), kind: "cmd", user: "a", line: "new", exit: 0, ms: 1, destructive: true })}\n`);
    expect(diary.query({ since: at(50) }).map((e) => e.text)).toEqual(["new"]);
  });

  test("broken lines are skipped", () => {
    appendFileSync(join(pvxHome(), "notes.jsonl"), `{nope\n${JSON.stringify({ v: 1, id: "n", at: at(1), ev: "add", author: "a", text: "ok" })}\n`);
    expect(diary.query().map((e) => e.text)).toEqual(["ok"]);
  });

  test("markSeen and novidades: per user, others' entries after the marker", () => {
    fixtures();
    expect(lastSeen("ana")).toBeUndefined();
    markSeen("ana", Date.parse(at(3)) + 1);
    expect(JSON.parse(readFileSync(join(pvxHome(), "seen", "ana.json"), "utf8"))).toEqual({ at: new Date(Date.parse(at(3)) + 1).toISOString() });
    expect(lastSeen("ana")).toBe(Date.parse(at(3)) + 1);
    const news = novidades(diary.query(), lastSeen("ana"), "ana");
    expect(news.map((e) => e.kind)).toEqual(["nota", "module"]); // ana's own login is not news to her
    expect(novidades(diary.query(), lastSeen("carlos"), "carlos")).toEqual([]); // carlos never visited: B's marker is its own
    markSeen("carlos", 0);
    expect(novidades(diary.query(), lastSeen("carlos"), "carlos").length).toBe(4);
  });

  test("`diario --json`: one line per entry with the entry attached", async () => {
    fixtures();
    const out: string[] = [];
    const code = await runCli({ argv: ["diario", "--json", "--tipo", "cmd,login"], env: {}, isTTY: false, isRoot: false, registry: build(), makeLogger, profilesDir: "", version: "1", theme, out: (l) => void out.push(l) });
    expect(code).toBe(0);
    const j = JSON.parse(out[0]!);
    expect(Object.keys(j)).toEqual(["ok", "exit", "lines"]);
    expect(j.lines).toEqual([
      { kind: "plain", text: expect.stringContaining("SSH de 203.0.113.50"), entry: expect.objectContaining({ kind: "login", user: "ana", at: at(4), data: { from: "203.0.113.50" } }) },
      { kind: "plain", text: expect.stringContaining("firewall apply"), entry: expect.objectContaining({ kind: "cmd", text: "firewall apply", data: { exit: 0, ms: 40, destructive: true } }) },
    ]);
    const bad: string[] = [];
    expect(await runCli({ argv: ["diario", "--tipo", "x"], env: {}, isTTY: false, isRoot: false, registry: build(), makeLogger, profilesDir: "", version: "1", theme, out: (l) => void bad.push(l) })).toBe(2);
  });
});
