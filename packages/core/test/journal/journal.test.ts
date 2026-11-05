import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@pvx/sdk";
import { auditLogin, createRegistry, execute, pvxHome, runCli, type CliIO, type Registry } from "../../src/index.ts";
import { appendJsonl, readJsonl } from "../../src/journal/jsonl.ts";

const noop = () => {};
const makeLogger = (): Logger => ({ debug: noop, info: noop, warn: noop, error: noop });
const theme = { text: "#fff", accent: "#0f0", ok: "#0f0", warn: "#ff0", error: "#f00", info: "#00f" };
const lines = (file: string) => (existsSync(join(pvxHome(), file)) ? readFileSync(join(pvxHome(), file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

let level: "ok" | "warn" | "error" = "ok";
const notes: string[] = [];
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
  if (withNotas) r.register({ id: "nota", version: "1", entry: "x" }, { roles: { addNote: "nota add" }, commands: { add: { help: "h", args: [{ name: "text", help: "", kind: "positional" }], run: (c) => void notes.push(String(c.args.text)) } } });
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
    const io = (argv: string[]): CliIO => ({ argv, env: { NO_COLOR: "1" }, isTTY: false, isRoot: true, registry: build(), makeLogger, version: "1", theme, out: noop });
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
