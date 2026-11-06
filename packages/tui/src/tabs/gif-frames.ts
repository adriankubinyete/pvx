import { decompressFrames, parseGIF } from "gifuct-js";

export interface GifFrame {
  /** The whole canvas after this frame, straight-alpha RGBA8: a transparent pixel has alpha 0. */
  rgba: Uint8Array;
  /** Milliseconds this frame stays on screen. */
  delay: number;
}

export interface Gif {
  width: number;
  height: number;
  frames: GifFrame[];
}

/** Disposal methods of GIF89a that matter here: 2 clears the frame's rectangle, 3 puts back what was under it. */
const RESTORE_BACKGROUND = 2;
const RESTORE_PREVIOUS = 3;
/** A GIF with no delay (or 0) plays at about 10 fps, as browsers do. */
const DEFAULT_DELAY_MS = 100;
const MIN_DELAY_MS = 20;

/** Copies the pixels of `patch` that are not transparent onto `canvas` (a GIF pixel is opaque or fully transparent). */
function drawPatch(canvas: Uint8Array, width: number, patch: Uint8ClampedArray, area: { left: number; top: number; width: number; height: number }): void {
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      const from = (y * area.width + x) * 4;
      if (patch[from + 3] === 0) continue;
      canvas.set(patch.subarray(from, from + 4), ((area.top + y) * width + area.left + x) * 4);
    }
  }
}

function clearArea(canvas: Uint8Array, width: number, area: { left: number; top: number; width: number; height: number }): void {
  for (let y = 0; y < area.height; y++) canvas.fill(0, ((area.top + y) * width + area.left) * 4, ((area.top + y) * width + area.left + area.width) * 4);
}

/** The most memory the canvases of one GIF may take (every frame is a full RGBA canvas). */
const MAX_BYTES = 96 * 1024 * 1024;

/** Every frame of a GIF as a full canvas with its transparency kept, disposal methods applied. Throws on a file that is not a GIF or is too big to hold. */
export function decodeGif(bytes: Uint8Array): Gif {
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const { width, height } = parsed.lsd;
  const count = parsed.frames.filter((frame) => "image" in frame).length;
  if (count === 0) throw new Error("o arquivo não tem quadros");
  if (width * height * 4 * count > MAX_BYTES) throw new Error(`gif grande demais: ${width}x${height}, ${count} quadros`);
  const canvas = new Uint8Array(width * height * 4);
  let before: Uint8Array | undefined;
  let last: { dims: { left: number; top: number; width: number; height: number }; disposalType: number } | undefined;
  const frames: GifFrame[] = [];
  for (const frame of decompressFrames(parsed, true)) {
    if (last?.disposalType === RESTORE_BACKGROUND) clearArea(canvas, width, last.dims);
    if (last?.disposalType === RESTORE_PREVIOUS && before) canvas.set(before);
    before = frame.disposalType === RESTORE_PREVIOUS ? canvas.slice() : undefined;
    drawPatch(canvas, width, frame.patch, frame.dims);
    frames.push({ rgba: canvas.slice(), delay: Math.max(MIN_DELAY_MS, frame.delay || DEFAULT_DELAY_MS) });
    last = frame;
  }
  return { width, height, frames };
}
