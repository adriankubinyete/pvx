import { expect, test } from "bun:test";
import { fixedClock } from "../src/sdk-ui/kit.tsx";
import { fixedNumber, fixedPercent, fixedRate } from "../src/fixed.ts";

// A live number keeps its width, so the columns after it do not jump (UI.md, "valor ao vivo tem largura fixa").

test("fixedNumber right-aligns the number in its width, then the unit", () => {
  expect(fixedNumber(96, { width: 5, unit: " proc" })).toBe("   96 proc");
  expect(fixedNumber(1234, { width: 5, unit: " proc" })).toBe(" 1234 proc");
  expect(fixedNumber(2.14, { width: 5, decimals: 2 })).toBe(" 2.14");
});

test("fixedRate is always 10 cells, from B/s to MB/s", () => {
  const rates = [0, 212, 1023, 1024, 340 * 1024, 1.2 * 1048576, 99.9 * 1048576, 100 * 1048576];
  for (const rate of rates) expect([...fixedRate(rate)], String(rate)).toHaveLength(10);
  expect(fixedRate(212)).toBe("  212 B/s ");
  expect(fixedRate(340 * 1024)).toBe("  340 KB/s");
  expect(fixedRate(1.2 * 1048576)).toBe("  1.2 MB/s");
});

test("fixedPercent keeps three cells for the number", () => {
  expect([5, 41, 100].map(fixedPercent)).toEqual(["  5%", " 41%", "100%"]);
});

test("fixedClock is six cells from seconds to hours, so the bar and the times after it do not move", () => {
  const times = [0, 9_000, 59_000, 60_000, 185_000, 3_599_000, 3_720_000];
  for (const ms of times) expect([...fixedClock(ms)], String(ms)).toHaveLength(6);
  expect(fixedClock(9_000)).toBe("    9s");
});
