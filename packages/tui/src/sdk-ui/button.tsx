import { useEffect, useRef, useState } from "react";
import type { Component, SdkUi } from "@pvx/sdk";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import type { Tokens } from "../theme.ts";
import { useHost } from "./host.tsx";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;

/** What a button is, apart from the screen it sits on. */
export interface ButtonKind {
  primary?: boolean;
  danger?: boolean;
  /** The reason the button is off. */
  disabled?: string;
  /** The keyboard focus or the mouse is on it. */
  lit?: boolean;
}

/** How a button is drawn: its text and colors. */
export interface ButtonLook {
  text: string;
  fg: string;
  bg?: string;
  bold: boolean;
  underline: boolean;
}

/**
 * The look of a button (UI.md, section 12). Every button is `[ label ]`, so nothing moves between states. Only a lit
 * (focused or hovered) button is filled, in its tone (accent, or error for a danger), and underlined; an unlit one is the
 * tone as text, bold for the primary. A disabled one is dim and never fills. So at most one button looks focused.
 */
export function buttonLook(label: string, kind: ButtonKind, c: Tokens): ButtonLook {
  const text = `[ ${clean(label)} ]`;
  const tone = kind.danger ? c.error : c.accent;
  if (kind.disabled !== undefined) return { text, fg: c.dim, bold: false, underline: false };
  if (kind.lit) return { text, fg: c.bg, bg: tone, bold: Boolean(kind.primary), underline: true };
  return { text, fg: tone, bold: Boolean(kind.primary), underline: false };
}

/** The text of a button with its bold and underline, ready to put in a `<text>`. */
export function LookText({ look }: { look: ButtonLook }) {
  const text = look.underline ? <u>{look.text}</u> : look.text;
  return (
    <text wrapMode="none" fg={look.fg} bg={look.bg}>
      {look.bold ? <b>{text}</b> : text}
    </text>
  );
}

/** The key of a `Button`: its own component, so the hook runs only when there is one. */
function ButtonKey({ keys, label, help, onPress }: { keys: string; label: string; help?: boolean; onPress: () => void }) {
  const host = useHost();
  const latest = useRef(onPress);
  latest.current = onPress;
  useEffect(() => host.addKey({ keys, label, help, run: () => latest.current() }), [host, keys, label, help]);
  return null;
}

/** Labels of the mounted buttons the keyboard cannot reach (see `isReachable`), with a count each. Read by `unreachableButtons`. */
const unreachable = new Map<string, number>();

/** A button the keyboard reaches either has a key (`keys`, shown in the footer) or is drawn focused by a page that navigates to it (`focused` given, true or false). */
const isReachable = ({ keys, focused }: { keys?: string; focused?: boolean }): boolean => keys !== undefined || focused !== undefined;

/** Labels of the buttons mounted now that no key and no focus reaches: only the mouse does. A test of a page expects this to be empty (UI.md, section 17). */
export const unreachableButtons = (): string[] => [...unreachable.keys()];

/** Counts a button in `unreachable` while it is mounted and cannot be reached. */
function useReachabilityCheck(label: string, reachable: boolean) {
  useEffect(() => {
    if (reachable) return;
    unreachable.set(label, (unreachable.get(label) ?? 0) + 1);
    return () => {
      const left = (unreachable.get(label) ?? 1) - 1;
      if (left > 0) unreachable.set(label, left);
      else unreachable.delete(label);
    };
  }, [label, reachable]);
}

export function Button({ label, onPress, primary, danger, disabled, keys, help, focused }: Props<"Button">) {
  const { c } = useTheme();
  const [hot, setHot] = useState(false);
  const off = disabled !== undefined;
  const look = buttonLook(label, { primary, danger, disabled, lit: focused || hot }, c);
  useReachabilityCheck(label, isReachable({ keys, focused }));
  const press = () => {
    if (!off) onPress();
  };
  return (
    <box flexShrink={0} flexDirection="column" onMouseDown={press} onMouseOver={() => setHot(true)} onMouseOut={() => setHot(false)}>
      {keys && !off ? <ButtonKey keys={keys} label={label} help={help} onPress={onPress} /> : null}
      <LookText look={look} />
      {off && disabled ? <text wrapMode="none" fg={c.dim}>{clean(disabled)}</text> : null}
    </box>
  );
}
