import { describe, expect, test } from "bun:test";
import { buildPlan, type EvalResult } from "../../src/plan/index.ts";

const r = (id: string, level: EvalResult["level"], extra: Partial<EvalResult> = {}): EvalResult =>
  ({ id, title: id, goal: "g", level, text: "", ...extra });
const cmds = (rs: EvalResult[]) => buildPlan(rs).steps.map((s) => s.cmd);

describe("buildPlan", () => {
  test("only an implicit step: target ok but affected", () => {
    const p = buildPlan([
      r("net.active", "ok", { fix: "net apply" }),
      r("net.base", "warn", { fix: "net trust-base", affects: ["net.active"] }),
    ]);
    expect(p.steps.map((s) => s.cmd)).toEqual(["net trust-base", "net apply"]);
    expect(p.steps[1]).toMatchObject({ implicit: true, for: ["net.active"] });
    expect(p.steps[1]!.reason).toContain("net.base");
    expect(p.steps[0]!.implicit).toBe(false);
  });

  test("target already pending moves after the last affecting step, not implicit", () => {
    const p = buildPlan([
      r("net.active", "error", { fix: "net apply" }),
      r("net.base", "warn", { fix: "net trust-base", affects: ["net.active"] }),
      r("net.extra", "warn", { fix: "net trust-extra", affects: ["net.active"] }),
    ]);
    expect(p.steps.map((s) => s.cmd)).toEqual(["net trust-base", "net trust-extra", "net apply"]);
    expect(p.steps.every((s) => !s.implicit)).toBe(true);
  });

  test("two steps affecting the same ok target yield a single apply", () => {
    const rs = [
      r("net.active", "ok", { fix: "net apply" }),
      r("net.base", "warn", { fix: "net trust-base", affects: ["net.active"] }),
      r("net.extra", "warn", { fix: "net trust-extra", affects: ["net.active"] }),
    ];
    expect(cmds(rs).filter((c) => c === "net apply")).toHaveLength(1);
    expect(cmds(rs).at(-1)).toBe("net apply");
  });

  test("needs orders topologically; independent steps keep profile order", () => {
    expect(
      cmds([
        r("a.x", "warn", { fix: "fix x", needs: ["a.y"] }),
        r("a.z", "warn", { fix: "fix z" }),
        r("a.y", "warn", { fix: "fix y" }),
      ]),
    ).toEqual(["fix z", "fix y", "fix x"]);
  });

  test("cycle in needs is a clear error listing the cycle", () => {
    expect(() =>
      buildPlan([
        r("a.x", "warn", { fix: "fix x", needs: ["a.y"] }),
        r("a.y", "warn", { fix: "fix y", needs: ["a.x"] }),
      ]),
    ).toThrow(/ciclo.*fix x -> fix y -> fix x/);
  });

  test("pending without fix is manual, no step", () => {
    const p = buildPlan([r("a.x", "error"), r("a.y", "ok"), r("a.z", "warn", { fix: "fix z" })]);
    expect(p.manual.map((m) => m.id)).toEqual(["a.x"]);
    expect(p.steps.map((s) => s.cmd)).toEqual(["fix z"]);
  });

  test("repeated fix command is deduplicated", () => {
    const p = buildPlan([r("a.x", "warn", { fix: "fix all" }), r("a.y", "error", { fix: "fix all" })]);
    expect(p.steps).toEqual([{ cmd: "fix all", for: ["a.x", "a.y"], implicit: false }]);
  });
});
