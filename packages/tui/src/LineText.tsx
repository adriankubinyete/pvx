import { windowLine, type Line } from "./lineedit.ts";
import { useTheme } from "./theme-context.tsx";

/**
 * Spans for a text field: the text with a block at the cursor (only when `focused`). `mask` hides the value.
 * `pad` fills the rest of `width` with spaces, so the field is as wide as its input cell. Put it inside `<text>`.
 */
export function LineText({ line, focused, width, mask, fg, pad = false }: { line: Line; focused: boolean; width: number; mask?: boolean; fg?: string; pad?: boolean }) {
  const { c, g } = useTheme();
  const shown = mask ? { text: g.mask.repeat([...line.text].length), cursor: line.cursor } : line;
  const color = fg ?? c.text;
  const [before, under, after] = windowLine(focused ? shown : { ...shown, cursor: [...shown.text].length }, width);
  const cursorCell = focused ? under : "";
  const rest = focused ? after : "";
  const used = [...before, ...cursorCell, ...rest].length;
  const filler = pad ? " ".repeat(Math.max(0, width - used)) : "";
  if (!focused) return <span fg={color}>{before + filler}</span>;
  return (
    <>
      <span fg={color}>{before}</span>
      <span fg={c.bg} bg={c.accent}>{cursorCell}</span>
      <span fg={color}>{rest + filler}</span>
    </>
  );
}
