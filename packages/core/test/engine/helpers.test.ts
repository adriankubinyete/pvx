import { expect, test } from "bun:test";
import { argGetters, proofKit } from "../../src/engine/helpers.ts";

test("argGetters reads text, flags, options and comma lists", () => {
  const get = argGetters({ name: "ana", dry: true, off: false, tags: " a, b ,,c" });
  expect(get.arg("name")).toBe("ana");
  expect(get.arg("dry")).toBeUndefined(); // a flag is not text
  expect(get.arg("missing")).toBeUndefined();
  expect(get.option("name")).toBe("ana");
  expect(get.flag("dry")).toBe(true);
  expect(get.flag("off")).toBe(false);
  expect(get.flag("missing")).toBe(false);
  expect(get.list("tags")).toEqual(["a", "b", "c"]);
  expect(get.list("missing")).toEqual([]);
});

test("proofKit builds proofs with their extras", () => {
  expect(proofKit.ok("bem")).toEqual({ level: "ok", text: "bem" });
  expect(proofKit.warn("atenção", { fix: "x apply", evidence: "porque" })).toEqual({ level: "warn", text: "atenção", fix: "x apply", evidence: "porque" });
  expect(proofKit.error("falhou").level).toBe("error");
});

test("firstProblem runs steps in order, skips ok and undefined, stops at the first problem", async () => {
  const ran: string[] = [];
  const step = (name: string, result?: ReturnType<typeof proofKit.ok>) => async () => (ran.push(name), result);
  const found = await proofKit.firstProblem(step("a"), step("b", proofKit.ok("ok")), step("c", proofKit.warn("w")), step("d", proofKit.error("e")));
  expect(found).toEqual({ level: "warn", text: "w" });
  expect(ran).toEqual(["a", "b", "c"]);
  expect(await proofKit.firstProblem(() => undefined, () => proofKit.ok("x"))).toBeUndefined();
  expect(await proofKit.firstProblem()).toBeUndefined();
});
