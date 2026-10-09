import type { ReactNode } from "react";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { KeyInput } from "@opentui/core/testing";

type Mods = { shift?: boolean; ctrl?: boolean; meta?: boolean };

export interface TuiHarness {
  /** Current frame as text. */
  frame(): string;
  /** Presses a key (`"a"`, `"L"`, `"RETURN"`, `"ESCAPE"`, `"ARROW_DOWN"`...) inside `act` and flushes. */
  press(key: KeyInput, mods?: Mods): Promise<void>;
  /** Types text char by char, each a `press`. */
  type(text: string): Promise<void>;
  /** Waits for pending timers and renders (use after something async). */
  flush(): Promise<void>;
  /** Waits until `pred` is true (polls in frames, not ms). */
  waitFor(pred: () => boolean): Promise<void>;
  /** Waits until `pred(frame)` is true; returns the matching frame. */
  waitForFrame(pred: (frame: string) => boolean): Promise<string>;
  resize(cols: number, rows: number): Promise<void>;
  /** Always call at the end (`afterEach`). Unmounts the tree. */
  destroy(): void;
}

/** Renders `element` in a headless terminal of `cols` x `rows`, with `act` and flush handled. */
export async function renderTui(element: ReactNode, { cols = 120, rows = 40 }: { cols?: number; rows?: number } = {}): Promise<TuiHarness> {
  // Kitty mode: ESC needs no parser timeout, and ctrl+enter / shift+enter can be sent.
  const t = await testRender(element, { width: cols, height: rows, kittyKeyboard: true });
  // `testRender` leaves IS_REACT_ACT_ENVIRONMENT on until destroy; with it on, every timer tick (spinner, log
  // refresh) and store update between our calls warns "not wrapped in act" (111 tests: 4 -> 146 warnings).
  // So it is on only while we are inside `act`.
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const inAct = async (fn: () => void | Promise<void>) => {
    env.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(fn);
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  };
  const flush = async () => {
    await inAct(async () => {}); // drains React effects
    await t.flush();
  };
  await flush();
  const press: TuiHarness["press"] = async (key, mods) => {
    await inAct(async () => t.mockInput.pressKey(key, mods)); // async callback: act also drains the store's promise continuations
    await flush();
  };
  return {
    frame: () => t.captureCharFrame(),
    flush,
    waitFor: (pred) => t.waitFor(pred),
    waitForFrame: (pred) => t.waitForFrame(pred),
    press,
    async type(text) {
      // Not `mockInput.typeText`: it drops keys here, since a handler reads the input state of its last render.
      // Kitty reports Shift+l as name `l`, sequence `L`, shift: so send the lowercase key with shift.
      for (const ch of text) await (ch !== ch.toLowerCase() ? press(ch.toLowerCase(), { shift: true }) : press(ch));
    },
    async resize(c, r) {
      await inAct(() => t.resize(c, r));
      await flush();
    },
    destroy() {
      if (t.renderer.isDestroyed) return;
      env.IS_REACT_ACT_ENVIRONMENT = true; // testRender's onDestroy turns it off again
      act(() => t.renderer.destroy()); // destroy updates the root outside the onDestroy `act`: still needs this one
    },
  };
}
