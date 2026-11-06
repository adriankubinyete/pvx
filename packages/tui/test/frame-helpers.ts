import { RGBA } from "@opentui/core";
import type { TuiHarness } from "../../testing/src/index.ts";
import { tokens } from "../src/theme.ts";

const FRAME_TITLE = /^(\d) \S/;
const NUMBER_ONLY = /^(\d) *$/;
/** The labels of the sections of Início: the number of an active header is a span of its own, right before its label. */
const HEADER_LABELS = ["Atenção", "Notas", "Atividade"];

/** The numbers of the sections that are active: a Frame title (bold, accent) or a section header whose number is drawn in the accent token. */
export function activeFrames(t: TuiHarness): string[] {
  const accent = RGBA.fromHex(tokens.accent);
  return t.spans().lines.flatMap((line) => line.spans.flatMap((span, index) => {
    if (!span.fg.equals(accent)) return [];
    const framed = FRAME_TITLE.exec(span.text)?.[1];
    const header = NUMBER_ONLY.test(span.text) && HEADER_LABELS.includes(line.spans[index + 1]?.text ?? "") ? NUMBER_ONLY.exec(span.text)![1] : undefined;
    const number = framed ?? header;
    return number ? [number] : [];
  }));
}
