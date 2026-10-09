import { windowLine, type Line } from "./lineedit.ts";
import { useTheme } from "./theme-context.tsx";

/** Spans for a text field: the text with a block at the cursor (only when `focused`). `mask` hides the value. Put it inside `<text>`. */
export function LineText({ line, focused, width, mask, fg }: { line: Line; focused: boolean; width: number; mask?: boolean; fg?: string }) {
  const { c, g } = useTheme();
  const shown = mask ? { text: g.active.repeat([...line.text].length), cursor: line.cursor } : line;
  const color = fg ?? c.text;
  if (!focused) return <span fg={color}>{windowLine({ ...shown, cursor: [...shown.text].length }, width)[0]}</span>; // no cursor: the tail of the text
  const [before, under, after] = windowLine(shown, width);
  return (
    <>
      <span fg={color}>{before}</span>
      <span fg={c.bg} bg={c.accent}>{under}</span>
      <span fg={color}>{after}</span>
    </>
  );
}
