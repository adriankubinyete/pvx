import { expect } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TuiHarness } from "../../testing/src/index.ts";
import { tokens } from "../src/theme.ts";

const accent = RGBA.fromHex(tokens.accent);
const subtle = RGBA.fromHex(tokens.dim);

/** Cell of the top-left corner of every card drawn with the accent border (the selected one): column and row. */
export const selectedCorners = (t: TuiHarness) => cornersWith(t, accent);
/** Cell of the top-left corner of the card with the muted border (selected while the grid has no focus). */
export const subtleCorners = (t: TuiHarness) => cornersWith(t, subtle);

function cornersWith(t: TuiHarness, color: RGBA): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  t.spans().lines.forEach((line, y) => {
    let x = 0;
    for (const s of line.spans) {
      const i = [...s.text].indexOf("╭");
      if (i >= 0 && s.fg.equals(color)) out.push({ x: x + i, y });
      x += s.width;
    }
  });
  return out;
}

/** Name of the card with the accent border, or undefined when none (the bar has the focus) or it is a dashed card. */
export function selectedName(t: TuiHarness): string | undefined {
  const c = selectedCorners(t)[0];
  if (!c) return undefined;
  const row = [...(t.frame().split("\n")[c.y + 1] ?? "")].slice(c.x).join("");
  return /^│ (?:◆|◇|dev) (\S+)/.exec(row)?.[1];
}

/** Moves through the cards (right by default) until the one named `name` is selected. */
export async function gotoCard(t: TuiHarness, name: string, key: "ARROW_RIGHT" | "ARROW_LEFT" = "ARROW_RIGHT") {
  for (let i = 0; i < 40 && selectedName(t) !== name; i++) await t.press(key);
  expect(selectedName(t)).toBe(name);
}

/** Text of the strip under the grid (what the selected card is, and its warning). */
export function detail(t: TuiHarness): string {
  const lines = t.frame().split("\n");
  const footer = lines.findLastIndex((l) => l.trim()); // the strip is the three rows above the footer: a blank one, the name line and the warning
  return lines.slice(Math.max(0, footer - 3), footer).map((l) => l.trim()).filter((l) => l && !/^[╰│╭]/.test(l)).join("\n");
}

/** Last non-empty line of the frame: the footer. */
export const footerLine = (t: TuiHarness) => t.frame().split("\n").filter((l) => l.trim()).at(-1)!;
