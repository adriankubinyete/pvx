import { writeSync } from "node:fs";

/** Kitty keyboard: pop up to 99 pushed levels. An empty stack just resets the flags to 0, so it is always safe. */
export const KITTY_POP_ALL = "\x1b[<99u";

/**
 * Leaves the keyboard protocol off, on the screen the cursor is on.
 * Why: a push (`CSI > 5 u`) that never got its pop (process killed, crash) stays in the terminal, and a later clean run
 * pushes on top of it and pops back to it, so the leak never heals and Ctrl+C at the shell prints `^[[99;5u`.
 */
export function resetKeyboard(write: (s: string) => unknown = (s) => writeSync(1, s)): void {
  try {
    write(KITTY_POP_ALL);
  } catch {}
}

/**
 * Runs `resetKeyboard` once when the process ends, whatever calls `process.exit` (the renderer's own teardown covers the
 * alternate screen; this covers the main screen, which has its own stack in kitty terminals).
 */
export function resetKeyboardOnExit(isTTY: boolean, write?: (s: string) => unknown): () => void {
  if (!isTTY) return () => {};
  const run = () => resetKeyboard(write);
  process.once("exit", run);
  return () => void process.off("exit", run);
}
