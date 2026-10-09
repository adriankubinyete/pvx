import { describe, expect, test } from "bun:test";
import { applyPlan, buildPlan, type EvalResult, type Plan } from "../../src/plan/index.ts";

const step = (cmd: string, extra = {}) => ({ cmd, for: [cmd], implicit: false, ...extra });
const plan = (...cmds: string[]): Plan => ({ steps: cmds.map((c) => step(c)), manual: [] });

describe("applyPlan", () => {
  test("stops at the first error", async () => {
    const ran: string[] = [];
    const res = await applyPlan(plan("a", "b", "c"), (s) => { ran.push(s.cmd); return s.cmd === "b" ? 1 : 0; });
    expect(ran).toEqual(["a", "b"]);
    expect(res.map((x) => x.status)).toEqual(["ok", "error"]);
  });

  test("steps stay frozen even if results/plan change mid-run", async () => {
    // Regression: the prototype iterated a live list that shrank as steps were applied.
    const p = plan("a", "b", "c");
    const ran: string[] = [];
    await applyPlan(p, (s) => { ran.push(s.cmd); p.steps.splice(0, 1); return 0; });
    expect(ran).toEqual(["a", "b", "c"]);
  });

  test("confirm: skip and stop", async () => {
    const ran: string[] = [];
    const res = await applyPlan(plan("a", "b", "c"), (s) => { ran.push(s.cmd); return 0; },
      (s) => (s.cmd === "a" ? "skip" : s.cmd === "b" ? "yes" : "stop"));
    expect(ran).toEqual(["b"]);
    expect(res.map((x) => x.status)).toEqual(["skipped", "ok"]);
  });

  test("opt-in step is never auto-applied without confirm", async () => {
    const results: EvalResult[] = [{ id: "a.x", title: "", goal: "", level: "warn", text: "", fix: "risky", optIn: true }];
    const ran: string[] = [];
    const res = await applyPlan(buildPlan(results), (s) => { ran.push(s.cmd); return 0; });
    expect(ran).toEqual([]);
    expect(res[0]!.status).toBe("skipped");
  });
});
