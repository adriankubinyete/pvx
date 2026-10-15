import type { TuiHarness } from "./render-tui.ts";

/** The footer of the tab bar says this; no page footer does. */
const BAR_FOOTER = "troca aba";
/** `esc` goes up one level at a time: a field, the page, the bar. A page needing more than this has a level too many. */
const MAX_ESC = 3;

const barHasKeyboard = (page: TuiHarness): boolean => page.frame().includes(BAR_FOOTER);

/**
 * Fails when `esc`, pressed at most three times, does not hand the keyboard to the tab bar. Mount the page with `renderTab` (the keyboard inside it)
 * and call this after the frame under test is up. Fix: a form gives `esc` up one level (`Fields` does); a page that takes `esc` itself must give it back.
 */
export async function expectNoKeyboardTrap(page: TuiHarness): Promise<void> {
  for (let pressed = 0; pressed < MAX_ESC; pressed++) {
    if (barHasKeyboard(page)) return;
    await page.press("ESCAPE");
  }
  if (!barHasKeyboard(page)) throw new Error(`teclado preso: ${MAX_ESC} esc não levaram à barra de abas. Dê o esc de volta ao host (UI.md, seção 1).`);
}
