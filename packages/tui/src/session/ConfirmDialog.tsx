import { useState, type ReactNode } from "react";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";

export interface ConfirmDialogProps {
  title: string;
  /** Dim lines under the title. */
  description?: string[];
  /** One label per button, left to right. */
  buttons: string[];
  /** The button that starts focused: the safe one. */
  initial: number;
  /** The button drawn in the error style (a destructive action); undefined: none. */
  destructive?: number;
  /** A button was activated (enter or a click). */
  onPick: (index: number) => void;
  /** `esc`. */
  onCancel: () => void;
}

/** Columns the border and padding take from the dialog width. */
const DIALOG_CHROME = 4;
/** Columns between two buttons. */
const BUTTON_GAP = 2;
/** The dialog never gets narrower than this, so a short title still reads as a dialog. */
const MIN_DIALOG_W = 36;

const buttonText = (label: string) => `[ ${clean(label)} ]`;

/** The width the content needs: the longest of the title, the description lines and the button row. */
function contentWidth({ title, description = [], buttons }: Pick<ConfirmDialogProps, "title" | "description" | "buttons">): number {
  const row = buttons.map((label) => buttonText(label).length).reduce((sum, n) => sum + n + BUTTON_GAP, -BUTTON_GAP);
  return Math.max(...[title, ...description].map((line) => [...clean(line)].length), row);
}

/** One button of the dialog: filled with its tone while focused, plain otherwise; hover focuses it, a click picks it. */
function DialogButton({ label, focused, tone, onHover, onPick }: { label: string; focused: boolean; tone: string; onHover: () => void; onPick: () => void }) {
  const { c } = useTheme();
  const text = buttonText(label);
  return (
    <box flexShrink={0} onMouseOver={onHover} onMouseDown={onPick}>
      <text wrapMode="none" fg={focused ? c.bg : tone} bg={focused ? tone : undefined}>{focused ? <b><u>{text}</u></b> : text}</text>
    </box>
  );
}

/**
 * A question that floats in the middle of the screen: a title line, a dim description and buttons, centered, each block set apart by a dim rule.
 * It shows no key hints (the keys are obvious). It owns the keyboard:
 * `←` `→` and `tab` move between the buttons, `enter` picks the focused one, `esc` cancels. The page behind stays visible, dimmed
 * (the backdrop and the dialog are siblings: `opacity` applies to a whole subtree). The only border is the dialog's own.
 */
export function ConfirmDialog({ title, description = [], buttons, initial, destructive, onPick, onCancel }: ConfirmDialogProps) {
  const { c, g, box } = useTheme();
  const { cols } = useLayout();
  const [focus, setFocus] = useState(initial);
  const step = (delta: number) => setFocus((focus + delta + buttons.length) % buttons.length);
  useKeys((key) => {
    if (key.name === "escape") return onCancel();
    if (matchKey(key, "enter")) return onPick(focus);
    if (key.name === "right" || matchKey(key, "tab")) return step(1);
    if (key.name === "left" || matchKey(key, "shift+tab")) return step(-1);
  }, { modal: true });
  const width = Math.min(cols - 2, Math.max(MIN_DIALOG_W, contentWidth({ title, description, buttons }) + DIALOG_CHROME));
  const toneOf = (index: number) => (index === destructive ? c.error : c.accent);
  const inner = width - DIALOG_CHROME;
  const rule = <text wrapMode="none" fg={c.dim} flexShrink={0}>{g.hline.repeat(inner)}</text>;
  const centered = (children: ReactNode, key?: number) => <box key={key} flexDirection="row" justifyContent="center" flexShrink={0}>{children}</box>;
  return (
    <>
      <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={19} backgroundColor={c.bg} opacity={0.6} />
      <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={20} alignItems="center" justifyContent="center">
        <box width={width} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(destructive === undefined ? c.accent : c.error)}>
          {centered(<text wrapMode="none" fg={c.text}><b>{clean(title)}</b></text>)}
          {rule}
          {description.length ? description.map((line, i) => centered(<text wrapMode="none" fg={c.dim}>{clean(line)}</text>, i)) : null}
          {description.length ? rule : null}
          {centered(
            <box flexDirection="row" flexShrink={0} gap={BUTTON_GAP}>
              {buttons.map((label, i) => (
                <DialogButton key={i} label={label} focused={i === focus} tone={toneOf(i)} onHover={() => setFocus(i)} onPick={() => onPick(i)} />
              ))}
            </box>,
          )}
        </box>
      </box>
    </>
  );
}
