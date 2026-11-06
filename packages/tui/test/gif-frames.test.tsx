import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { defaultTuiState, pvxHome, saveTuiState } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { clipSize, HomeClip } from "../src/tabs/HomeClip.tsx";
import { decodeGif } from "../src/tabs/gif-frames.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const asset = join(import.meta.dir, "fixtures/clip.gif"); // 32x32, four frames of 100 ms: a red square that moves, on a transparent canvas

test("decodeGif: every frame is a full canvas, the transparent pixels keep alpha 0 and the frames differ", async () => {
  const gif = decodeGif(new Uint8Array(await Bun.file(asset).arrayBuffer()));
  expect([gif.width, gif.height, gif.frames.length]).toEqual([32, 32, 4]);
  const opaque = (rgba: Uint8Array) => rgba.filter((_, i) => i % 4 === 3 && rgba[i] === 255).length;
  for (const frame of gif.frames) {
    expect(frame.rgba.length).toBe(32 * 32 * 4);
    expect(frame.delay).toBe(100);
    expect(frame.rgba[3]).toBe(0); // the top-left corner of the canvas is transparent
    expect(opaque(frame.rgba)).toBe(144); // only the 12x12 square is drawn
  }
  expect(gif.frames[0]!.rgba).not.toEqual(gif.frames[2]!.rgba); // and it moves
});

test("HomeClip: draws nothing until a GIF is chosen; then the transparent pixels show what is behind it and the picture changes over time", async () => {
  const behind = "#0000ff";
  const state = join(pvxHome(), "clip-state.json");
  const page = () => (
    <ThemeProvider statePath={state}><KeyRouter onQuit={() => {}}><box width={30} height={14} backgroundColor={behind}><HomeClip cols={120} /></box></KeyRouter></ThemeProvider>
  );
  const picture = () => JSON.stringify(h!.spans().lines.slice(0, 12).map((line) => line.spans.map((span) => [span.text, span.fg.toInts(), span.bg.toInts()])));
  h = await renderTui(page(), { cols: 40, rows: 16 });
  expect(h.frame().includes("█") || h.frame().includes("▀") || h.frame().includes("▄")).toBe(false); // none chosen: nothing is drawn
  h.destroy();
  saveTuiState({ ...defaultTuiState(), homeGif: asset }, state);
  h = await renderTui(page(), { cols: 40, rows: 16 });
  await h.waitFor(() => /[█▀▄▌▐▖▗▘▝▙▛▜▟]/.test(h!.frame()));
  const first = picture();
  expect(first).toContain("0,0,255,255"); // the blue behind shows through the transparent area
  let changed = false;
  for (let i = 0; i < 40 && !changed; i++) {
    await Bun.sleep(50);
    await h.flush();
    changed = picture() !== first;
  }
  expect(changed).toBe(true);
}, 15_000);

test("clipSize: a share of the terminal width between the limits, half as many rows as columns", () => {
  expect(clipSize(108)).toEqual({ width: 32, height: 16 });
  expect(clipSize(250)).toEqual({ width: 70, height: 35 });
  expect(clipSize(80).width).toBe(26); // never smaller than the minimum
  for (const cols of [80, 120, 160, 250]) expect(clipSize(cols).height).toBe(Math.round(clipSize(cols).width / 2));
});
