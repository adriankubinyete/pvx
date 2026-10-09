import type { ReactNode } from "react";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { KeyInput } from "@opentui/core/testing";

type Mods = { shift?: boolean; ctrl?: boolean; meta?: boolean };

/** A lone ESC waits for the parser timeout before it is reported. */
const ESC_WAIT_MS = 120;

export interface TuiHarness {
  /** Current frame as text. */
  frame(): string;
  /** Presses a key (`"a"`, `"L"`, `"RETURN"`, `"ESCAPE"`, `"ARROW_DOWN"`...) inside `act` and flushes. Waits after ESC. */
  press(key: KeyInput, mods?: Mods): Promise<void>;
  /** Types text char by char, each in `act` + flush. */
  type(text: string): Promise<void>;
  /** Waits for pending timers and renders (use after something async). */
  flush(): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  /** Always call at the end (`afterEach`). Unmounts the tree. */
  destroy(): void;
}

/** Renders `element` in a headless terminal of `cols` x `rows`, with `act` and flush handled. */
export async function renderTui(element: ReactNode, { cols = 120, rows = 40 }: { cols?: number; rows?: number } = {}): Promise<TuiHarness> {
  const t = await testRender(element, { width: cols, height: rows });
  const settle = async () => {
    await act(async () => {});
    await t.flush();
  };
  await settle();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const press: TuiHarness["press"] = async (key, mods) => {
    await act(async () => {
      t.mockInput.pressKey(key, mods);
    });
    await settle(); // act commits React; the flush then repaints
    if (key === "ESCAPE") {
      await sleep(ESC_WAIT_MS);
      await settle();
    }
  };
  return {
    frame: () => t.captureCharFrame(),
    flush: settle,
    press,
    async type(text) {
      for (const ch of text) await press(ch, ch !== ch.toLowerCase() ? { shift: true } : undefined);
    },
    async resize(c, r) {
      await act(async () => t.resize(c, r));
      await settle();
    },
    destroy: () => t.renderer.destroy(),
  };
}
