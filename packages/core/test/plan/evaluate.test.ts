import { describe, expect, test } from "bun:test";
import type { CapabilityDef } from "@pvx/sdk";
import { evaluate, type Profile } from "../../src/plan/index.ts";

const ctx = { log: {} as any, store: {} as any, query: (() => {}) as any, session: { sshClient: undefined }, exec: {} as any, fs: {} as any, jobs: {} as any, phases: {} as any, shell: {} as any, strategy: {} as any };
const cap = (id: string, prove: CapabilityDef["prove"], extra: Partial<CapabilityDef> = {}): CapabilityDef =>
  ({ id, title: id, goal: "g", prove, ...extra });
const profile = (requires: string[]): Profile => ({ id: "p", title: "P", requires });

describe("evaluate", () => {
  test("timeout and exception become error; others still run; fix from Proof overrides def", async () => {
    const caps = new Map([
      cap("a.slow", () => new Promise(() => {}), { fix: "fix slow" }),
      cap("a.boom", () => { throw new Error("boom"); }),
      cap("a.ok", () => ({ level: "ok", text: "fine", fix: "proof fix" }), { fix: "def fix" }),
    ].map((c) => [c.id, c] as const));
    const res = await evaluate(profile(["a.slow", "a.boom", "a.ok"]), caps, () => ctx, { timeoutMs: 20 });
    expect(res.map((x) => x.level)).toEqual(["error", "error", "ok"]);
    expect(res[0]!.text).toContain("tempo esgotado");
    expect(res[0]!.fix).toBe("fix slow");
    expect(res[1]!.text).toBe("boom");
    expect(res[2]!.fix).toBe("proof fix");
  });

  test("capability from a missing module becomes warn, profile order kept", async () => {
    const caps = new Map([cap("a.ok", () => ({ level: "ok", text: "" }))].map((c) => [c.id, c] as const));
    const res = await evaluate(profile(["gone.x", "a.ok"]), caps, () => ctx);
    expect(res[0]).toMatchObject({ id: "gone.x", level: "warn", text: "módulo ausente" });
    expect(res[1]!.id).toBe("a.ok");
  });
});
