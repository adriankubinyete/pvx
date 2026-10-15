import type { Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useTheme } from "../theme-context.tsx";
import { contrast, normalizeHex, TEXT_TOKENS, type HexTokens, type TokenKey } from "../theme.ts";
import type { Options } from "./sistema.ts";

/** The themes with known hex values: the ones "começar de" can copy. */
export const SOURCES: Options = [["dark", "Escuro"], ["light", "Claro"], ["contrast", "Alto contraste"]];
const HEX_W = 9;
/** The contrast under which a text color is flagged. */
const MIN_CONTRAST = 4.5;
/** A color that is not text has nothing to flag. */
const NO_CONTRAST = 21;

/** The control of the "começar de" row: `‹ Escuro ›`. */
export function FromControls({ from }: { from: string }) {
  const { c, g } = useTheme();
  return <text wrapMode="none" fg={c.text} flexShrink={0}>{`${g.moreLeft} ${SOURCES.find(([value]) => value === from)![1]} ${g.moreRight}`}</text>;
}

interface TokenProps {
  token: TokenKey;
  hex: HexTokens;
  /** The hex being typed on this row, when it is the one edited. */
  edit: Line | null;
  /** The mouse is over the value. */
  hot: boolean;
  onOverValue: () => void;
  onOutValue: () => void;
  /** A click on the value edits it. */
  onPressValue: () => void;
}

/** The control of a color row: its hex (clickable), a swatch of it and, for a text color under 4.5:1 on the background, the ratio as a warning. */
export function TokenControls({ token, hex, edit, hot, onOverValue, onOutValue, onPressValue }: TokenProps) {
  const { c, g } = useTheme();
  const value = hex[token];
  const editing = edit !== null;
  const ratio = TEXT_TOKENS.includes(token) ? contrast(value, hex.bg) : NO_CONTRAST;
  const shown = editing ? normalizeHex(edit.text) : value;
  return (
    <>
      <box flexShrink={0} onMouseOver={onOverValue} onMouseOut={onOutValue} onMouseDown={onPressValue}>
        <text wrapMode="none">{editing ? <LineText line={edit} focused width={HEX_W} /> : <span fg={c.text}>{hot ? <u>{value}</u> : value}</span>}</text>
      </box>
      <text wrapMode="none" flexShrink={0}>
        <span bg={shown ?? undefined}>{shown ? "   " : ""}</span>
        {!editing && ratio < MIN_CONTRAST ? <span fg={c.warn}>{` ${g.warn} ${ratio.toFixed(1)}:1`}</span> : null}
      </text>
    </>
  );
}
