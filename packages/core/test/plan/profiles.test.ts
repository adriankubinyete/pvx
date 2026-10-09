import { describe, expect, test } from "bun:test";
import { selectProfile, type Profile } from "../../src/plan/index.ts";

const ps: Profile[] = [
  { id: "p1", title: "1", when: { file: "/only/here" }, requires: [] },
  { id: "p2", title: "2", requires: [] },
];

describe("selectProfile", () => {
  test("first whose when holds", () => {
    expect(selectProfile(ps, {}, (f) => f === "/only/here")?.id).toBe("p1");
    expect(selectProfile(ps, {}, () => false)?.id).toBe("p2");
  });
  test("PVX_PROFILE forces one; unknown id is a clear error", () => {
    expect(selectProfile(ps, { PVX_PROFILE: "p1" }, () => false)?.id).toBe("p1");
    expect(() => selectProfile(ps, { PVX_PROFILE: "nope" }, () => true)).toThrow(/nope.*p1, p2/);
  });
  test("no applicable profile returns null, never throws", () => {
    expect(selectProfile([ps[0]!], {}, () => false)).toBeNull();
    expect(selectProfile([], {}, () => true)).toBeNull();
  });
});
