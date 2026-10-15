import { expect, test } from "bun:test";
import { BAR_FILL, BAR_PERCENT_W, barMeterParts } from "../src/sdk-ui/display.ts";

test("the bar is the pipes, the empty cells and the percentage: the same width at any value", () => {
  const inner = 30;
  for (const value of [0, 0.01, 0.54, 0.99, 1, 1.5, -1]) {
    const { filled, empty, percent } = barMeterParts(value, inner);
    expect(filled.length + empty.length + percent.length, `value ${value}`).toBe(inner);
    expect(percent.length).toBe(BAR_PERCENT_W);
  }
  expect(barMeterParts(0.54, 30)).toEqual({ filled: BAR_FILL.repeat(13), empty: " ".repeat(11), percent: " 54.0%" });
  expect(barMeterParts(1, 30).percent).toBe("100.0%");
  expect(barMeterParts(0, 30).filled).toBe("");
  expect(barMeterParts(0.5, 4)).toEqual({ filled: "", empty: "", percent: " 50.0%" }); // narrower than the percentage: only the percentage
});

test("a text takes the place of the percentage, right-aligned inside the bar", () => {
  const parts = barMeterParts(0.5, 30, "6,4/13,7G");
  expect(parts.percent).toBe("6,4/13,7G");
  expect(parts.filled.length + parts.empty.length + parts.percent.length).toBe(30);
});
