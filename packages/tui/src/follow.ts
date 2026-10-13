import { useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

/**
 * A scrollbox that follows its newest content while the view is at the bottom. OpenTUI's sticky scroll pauses by itself
 * when the user scrolls up (wheel, PageUp) and resumes when they get back to the end. Do not call `scrollChildIntoView`
 * on the last child to "follow": it reads a layout that is not measured yet and ends the sticky state.
 */
export const followProps = { stickyScroll: true, stickyStart: "bottom" } as const;

export function useFollow() {
  const ref = useRef<ScrollBoxRenderable>(null);
  return {
    ref,
    /** Re-arms following. Call it before the content grows: the clamp uses the layout measured so far. */
    toBottom() {
      const s = ref.current;
      if (s) s.scrollTo(s.scrollHeight);
    },
    /** One page up (-1) or down (1). Keeps the sticky state in sync, so reaching the end resumes following. */
    page(dir: 1 | -1) {
      const s = ref.current;
      if (s) s.scrollBy(dir * Math.max(1, s.viewport.height - 1));
    },
  };
}
