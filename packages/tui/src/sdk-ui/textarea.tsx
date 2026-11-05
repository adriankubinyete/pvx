import { useRef } from "react";
import type { TextareaRenderable } from "@opentui/core";
import type { SdkUi } from "@pvx/sdk";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";

type Props = Parameters<SdkUi["TextArea"]>[0] & {
  /** The host's own: the renderable, so a form can read the text when it submits. */
  areaRef?: (area: TextareaRenderable | null) => void;
};

/** Rows of a TextArea when the module gives none. */
export const DEFAULT_ROWS = 5;

/**
 * A multiline text box with a border and the title in it. The border is accent when `focused`.
 * It owns the arrows and enter while focused (`useKeyboard` of the page runs first: read the text by `onChange`, never by key).
 */
export function TextArea({ title, initial = "", rows = DEFAULT_ROWS, placeholder, focused = false, onChange, onPress, areaRef }: Props) {
  const { c, box } = useTheme();
  const area = useRef<TextareaRenderable | null>(null);
  const last = useRef(initial);
  const attach = (r: TextareaRenderable | null) => {
    if (r && r !== area.current) r.gotoBufferEnd(); // typing continues after the initial text
    area.current = r;
    areaRef?.(r);
  };
  /** Only a real edit is reported: setting the initial text is not one. */
  const changed = () => {
    const text = area.current?.plainText ?? "";
    if (text === last.current) return;
    last.current = text;
    onChange?.(text);
  };
  return (
    <box flexShrink={0} height={rows + 2} {...box(focused ? c.accent : c.border)} title={title === undefined ? undefined : clean(title)} onMouseDown={onPress}>
      <textarea ref={attach} focused={focused} initialValue={initial} placeholder={placeholder === undefined ? undefined : clean(placeholder)} onContentChange={changed} flexGrow={1} />
    </box>
  );
}
