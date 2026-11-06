import { useEffect, useState } from "react";
import { useTheme } from "../theme-context.tsx";
import { CLIP_MIN_W, clipSize, HomeClip } from "./HomeClip.tsx";
import { renderText } from "./logo-font.ts";
import { LOGO_BOX_W, logoFrames, logoRows, type LogoFrame } from "./logo-frames.ts";
import { MARQUEE_PERIOD, MARQUEE_STEP_MS, marqueeRows } from "./marquee.ts";

export { LOGO_W } from "./logo-frames.ts";

/** Cells between the sign and the GIF the technician chose. */
const GAP_W = 4;
/** From this many columns a chosen GIF has room beside the sign (the sign keeps at least one copy of the mark). */
export const CLIP_FROM = LOGO_BOX_W + GAP_W + CLIP_MIN_W + 8;

const FRAMES = logoFrames();

/**
 * The mark as a typewriter: written with a blinking cursor, erased, a wait, typed again (`logo-frames.ts`). The step is state of this
 * component alone, so only these five rows draw again on each tick; the timer lives while the mark is mounted.
 */
export function TypedLogo({ frames = FRAMES }: { frames?: readonly LogoFrame[] }) {
  const { c } = useTheme();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setStep((step + 1) % frames.length), frames[step]!.ms);
    return () => clearTimeout(timer);
  }, [step, frames]);
  return (
    <box flexDirection="column" flexShrink={0} width={LOGO_BOX_W}>
      {logoRows(frames[step]!).map((row, index) => <text key={index} wrapMode="none" flexShrink={0} fg={c.accent} selectable={false}>{row}</text>)}
    </box>
  );
}

/**
 * The mark as a bus sign: it scrolls to the left across `width` cells and begins again, forever. The offset is state of this component alone,
 * so only these five rows draw again on each step, and the timer lives while it is mounted.
 */
export function Marquee({ width }: { width: number }) {
  const { c } = useTheme();
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setOffset((offset + 1) % MARQUEE_PERIOD), MARQUEE_STEP_MS);
    return () => clearTimeout(timer);
  }, [offset]);
  return (
    <box flexDirection="column" flexShrink={0} width={width}>
      {marqueeRows(offset, width).map((row, index) => <text key={index} wrapMode="none" flexShrink={0} fg={c.accent} selectable={false}>{row}</text>)}
    </box>
  );
}

/** What the fixed mark says: the product alone (70 cells), so it fits any terminal from 80 columns. */
const MARK_TEXT = "PHONEVOX";
const MARK = (() => {
  const rows = renderText(MARK_TEXT);
  return { rows, width: Math.max(...rows.map((row) => [...row].length)) };
})();

/** Cells of blank between the letters and the rule at each side. */
const RULE_GAP_W = 2;
/** The row of the mark the rules run along: the middle one. */
const RULE_ROW = 2;

/** One side of the mark: the rule on its middle row, blank on the others, so the five rows stay in step with the letters. */
function Rule({ cells, rows }: { cells: number; rows: number }) {
  const { c, g } = useTheme();
  return (
    <box flexDirection="column" flexShrink={0} width={cells}>
      {Array.from({ length: rows }, (_, index) => <text key={index} wrapMode="none" flexShrink={0} fg={c.border} selectable={false}>{index === RULE_ROW ? g.hline.repeat(cells) : " ".repeat(cells)}</text>)}
    </box>
  );
}

/**
 * The fixed mark across `width` cells: the letters in the middle and, on their middle row, a rule at each side that runs to the edge of the page
 * (`───── PHONEVOX ─────`). No timer, nothing draws again: it costs nothing on a weak machine. Draws nothing where the letters do not fit.
 */
export function FixedLogo({ width }: { width: number }) {
  const { c } = useTheme();
  if (MARK.width > width) return null;
  const side = width - MARK.width - 2 * RULE_GAP_W; // cells for the two rules together
  const left = side > 0 ? Math.floor(side / 2) : 0;
  const right = side > 0 ? side - left : 0;
  return (
    <box flexDirection="row" flexShrink={0} width={width}>
      {left > 0 ? <><Rule cells={left} rows={MARK.rows.length} /><box width={RULE_GAP_W} flexShrink={0} /></> : <box flexGrow={1} />}
      <box flexDirection="column" flexShrink={0}>
        {MARK.rows.map((row, index) => <text key={index} wrapMode="none" flexShrink={0} fg={c.accent} selectable={false}>{row}</text>)}
      </box>
      {right > 0 ? <><box width={RULE_GAP_W} flexShrink={0} /><Rule cells={right} rows={MARK.rows.length} /></> : <box flexGrow={1} />}
    </box>
  );
}

/**
 * The mark across the page, between the machine block and the sections: fixed (`FixedLogo`). A GIF chosen in Sistema takes the right end of
 * the row when the terminal is wide enough, and the mark is centered in the rest. (`Marquee`, the scrolling sign, and `TypedLogo`, the
 * typewriter, are kept and unused: they animate, and the production machine is too weak for that.)
 */
export function HomeLogo({ cols, width }: { cols: number; width: number }) {
  const { axes } = useTheme();
  const withClip = axes.homeGif !== "" && cols >= CLIP_FROM;
  const clipRoom = withClip ? clipSize(cols).width + GAP_W : 0;
  return (
    <box flexDirection="row" alignItems="center" columnGap={GAP_W} flexShrink={0} marginTop={1}>
      <FixedLogo width={width - clipRoom} />
      {withClip ? <HomeClip cols={cols} /> : null}
    </box>
  );
}
