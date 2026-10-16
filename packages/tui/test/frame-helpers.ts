import { RGBA } from "@opentui/core";
import type { TuiHarness } from "../../testing/src/index.ts";
import { tokens } from "../src/theme.ts";

const FRAME_TITLE = /^(\d) \S/;

/** The numbers of the Frames that are active: their title is drawn bold in the accent token. */
export function activeFrames(t: TuiHarness): string[] {
  const accent = RGBA.fromHex(tokens.accent);
  const spans = t.spans().lines.flatMap((line) => line.spans);
  return spans.flatMap((span) => {
    const number = FRAME_TITLE.exec(span.text)?.[1];
    return number && span.fg.equals(accent) ? [number] : [];
  });
}
