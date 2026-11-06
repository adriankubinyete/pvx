import { expect, test } from "bun:test";
import { renderText } from "../src/tabs/logo-font.ts";
import { MARQUEE_PERIOD, marqueeRows, SIGN_TEXT, SIGN_W } from "../src/tabs/marquee.ts";

test("marqueeRows: five rows, each exactly `width` cells, the text at the left at offset 0", () => {
  for (const width of [40, 70, 116, 246]) {
    const rows = marqueeRows(0, width);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect([...row].length).toBe(width);
  }
  expect(marqueeRows(0, SIGN_W)).toEqual(renderText(SIGN_TEXT).map((row) => row.padEnd(SIGN_W)));
});

test("marqueeRows: scrolling one cell moves everything one cell to the left, and after one period it is the same again", () => {
  const width = 100;
  const at = (offset: number) => marqueeRows(offset, width);
  expect(at(1).map((row) => row.slice(0, width - 1))).toEqual(at(0).map((row) => row.slice(1)));
  expect(at(MARQUEE_PERIOD)).toEqual(at(0));
  expect(at(MARQUEE_PERIOD + 5)).toEqual(at(5));
});

test("marqueeRows: a second copy follows the first after the gap, so the sign is never empty while it scrolls", () => {
  const rows = marqueeRows(0, 500);
  expect(rows[0]!.split("██████   ██   ██").length - 1).toBeGreaterThanOrEqual(2);
  for (let offset = 0; offset < MARQUEE_PERIOD; offset++) expect(marqueeRows(offset, 60).some((row) => row.includes("█"))).toBe(true);
});
