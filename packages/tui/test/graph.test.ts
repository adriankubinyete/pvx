import { expect, test } from "bun:test";
import { graph } from "../src/graph.ts";
import { glyphs } from "../src/theme.ts";

test("braille graph: two values per cell, four dot levels, stretched to the width", () => {
  expect(graph([0, 100], 1, 1, glyphs.unicode)).toEqual(["⣸"]); // baseline left, full right
  expect(graph([100, 100], 1, 1, glyphs.unicode)).toEqual(["⣿"]);
  expect(graph([], 3, 1, glyphs.unicode)).toEqual(["⣀⣀⣀"]);
  expect(graph([0, 100], 6, 1, glyphs.unicode)[0]).toHaveLength(6);
  expect(graph([100, 100], 1, 2, glyphs.unicode)).toEqual(["⣿", "⣿"]);
  expect(graph([50, 50], 1, 2, glyphs.unicode)).toEqual([" ", "⣿"]); // 50% of 2 rows: the bottom one full
});

test("block fallback: one character per cell, from the glyph table (also ASCII)", () => {
  expect(graph([0, 50, 100], 3, 1, { ...glyphs.unicode, braille: "" })).toEqual(["▁▄█"]);
  expect(graph([0, 100], 2, 1, glyphs.ascii)).toEqual(["_#"]);
  expect(graph([100], 1, 2, glyphs.ascii)).toEqual(["#", "#"]);
});
