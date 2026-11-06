import { expect, test } from "bun:test";
import { renderText } from "../src/tabs/logo-font.ts";
import { SIGN_TEXT } from "../src/tabs/marquee.ts";

test("renderText: PHONEVOX is the mark as it always was", () => {
  expect(renderText("PHONEVOX")).toEqual([
    "██████   ██   ██   █████   ███   █  ███████  ██   ██   █████   ██   ██",
    "██   ██  ██   ██  ██   ██  ████  █  ██       ██   ██  ██   ██   ██ ██",
    "██████   ███████  ██   ██  ██ ██ █  █████    ██   ██  ██   ██    ███",
    "██       ██   ██  ██   ██  ██  ███  ██        ██ ██   ██   ██   ██ ██",
    "██       ██   ██   █████   ██   ██  ███████    ███     █████   ██   ██",
  ]);
});

test("renderText: every letter of the sign has a glyph, the words are apart, and an unknown character throws", () => {
  const rows = renderText(SIGN_TEXT);
  expect(rows).toHaveLength(5);
  expect(renderText("GROUP")[0]!.length).toBeLessThan(rows[0]!.length);
  expect(rows[0]!.includes("█       ")).toBe(true); // a blank run wider than a letter gap: the space between two words
  expect(() => renderText("PHONEVOX 7")).toThrow();
  expect(renderText("phonevox")).toEqual(renderText("PHONEVOX")); // case does not matter
});
