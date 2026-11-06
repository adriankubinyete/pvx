import { afterEach, expect, test } from "bun:test";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { TypedLogo } from "../src/tabs/HomeLogo.tsx";
import { CURSOR_ROOM_W, LOGO, LOGO_BOX_W, logoFrames, logoRows, letterSpans } from "../src/tabs/logo-frames.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

test("letterSpans finds the eight letters of PHONEVOX", () => {
  const spans = letterSpans();
  expect(spans).toHaveLength(8);
  for (const [first, last] of spans) expect(last).toBeGreaterThan(first);
  for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeGreaterThan(spans[i - 1]![1] + 1); // a blank column between two letters
});

test("logoFrames: starts written with a blinking cursor, erases, waits on the empty line, types again", () => {
  const frames = logoFrames();
  expect(frames[0]).toMatchObject({ letters: 8, cursor: true });
  expect(frames[1]).toMatchObject({ letters: 8, cursor: false }); // it blinks
  const letters = frames.map((f) => f.letters);
  expect(Math.min(...letters)).toBe(0);
  expect(frames.some((f) => f.letters === 0 && !f.cursor)).toBe(true); // the wait: the line is empty and the cursor blinks
  const erasing = frames.filter((f) => f.cursor && f.letters < 8 && f.ms < 100);
  expect(erasing.map((f) => f.letters)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]); // from the end, one letter at a time
  const typing = frames.filter((f) => f.cursor && f.ms === 140).map((f) => f.letters);
  expect(typing).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

test("logoRows: every row is the same width, the letters stop where the frame says, the cursor stands after the last one", () => {
  const full = logoRows({ letters: 8, cursor: false });
  expect(full.map((row) => row.trim())).toEqual(LOGO.map((row) => row.trimEnd()));
  for (const row of full) expect([...row].length).toBe(LOGO_BOX_W);
  const first = logoRows({ letters: 1, cursor: true })[0]!;
  expect(first.startsWith(" ".repeat(CURSOR_ROOM_W) + "██████")).toBe(true); // the P
  expect(first.slice(CURSOR_ROOM_W + 7).trim()).toBe("██"); // and, one cell after it, the cursor
  expect(logoRows({ letters: 0, cursor: true })[0]!.trim()).toBe("██"); // empty line, only the cursor
  expect(logoRows({ letters: 0, cursor: false }).every((row) => row.trim() === "")).toBe(true);
  expect(logoRows({ letters: 8, cursor: true })[2]!.trimEnd().endsWith("██")).toBe(true); // the cursor fits in the room beside the last letter
});

test("TypedLogo plays: it goes through the frames it is given, one after the other", async () => {
  const quick = [{ letters: 8, cursor: true, ms: 30 }, { letters: 3, cursor: true, ms: 30 }, { letters: 0, cursor: false, ms: 30 }];
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><TypedLogo frames={quick} /></KeyRouter></ThemeProvider>, { cols: 90, rows: 10 });
  const seen = new Set<string>();
  for (let i = 0; i < 60 && seen.size < 3; i++) {
    seen.add(h.frame().split("\n")[0]!.trim());
    await Bun.sleep(15);
    await h.flush();
  }
  expect(seen.size).toBeGreaterThanOrEqual(3); // the first row changed at least three times
}, 10_000);
