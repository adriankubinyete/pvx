import { useEffect, useState } from "react";
import { NativeImage } from "@opentui/core";
import { useTheme } from "../theme-context.tsx";
import { decodeGif } from "./gif-frames.ts";

/** The clip is as wide as this share of the terminal, between the two limits (cells). */
const CLIP_SHARE = 0.3;
export const CLIP_MIN_W = 26;
const CLIP_MAX_W = 70;
/** Height over width in cells: a cell is about twice as tall as it is wide, so a square picture needs half the rows. */
const CLIP_ASPECT = 0.5;

/** Cells the clip takes on a terminal `cols` wide. */
export function clipSize(cols: number): { width: number; height: number } {
  const width = Math.min(CLIP_MAX_W, Math.max(CLIP_MIN_W, Math.floor(cols * CLIP_SHARE)));
  return { width, height: Math.round(width * CLIP_ASPECT) };
}

export interface Playing {
  images: NativeImage[];
  delays: number[];
}

/** Decodes a GIF once: a native image per frame, so playing is only swapping which one is shown. */
export async function load(path: string): Promise<Playing> {
  const gif = decodeGif(new Uint8Array(await Bun.file(path).arrayBuffer()));
  return { images: gif.frames.map((frame) => NativeImage.fromRgba(frame.rgba, gif.width, gif.height)), delays: gif.frames.map((frame) => frame.delay) };
}

/** The looping GIF the technician chose in Sistema, with its transparency: the transparent pixels show the page behind. With none chosen, or one that cannot be read, it draws nothing. */
export function HomeClip({ cols }: { cols: number }) {
  const { width, height } = clipSize(cols);
  const chosen = useTheme().axes.homeGif;
  const [playing, setPlaying] = useState<Playing | undefined>(undefined);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let alive = true;
    let loaded: Playing | undefined;
    setIndex(0);
    const show = (p: Playing) => (alive ? (loaded = p, setPlaying(p)) : p.images.forEach((image) => image.dispose()));
    setPlaying(undefined);
    // A chosen file that went away or is not a GIF any more draws nothing.
    if (chosen !== "") load(chosen).then(show, () => {});
    return () => {
      alive = false;
      loaded?.images.forEach((image) => image.dispose());
    };
  }, [chosen]);
  // The only timer: it lives while the clip is mounted, and a one-frame GIF needs none.
  useEffect(() => {
    if (!playing || playing.images.length < 2) return;
    const timer = setTimeout(() => setIndex((index + 1) % playing.images.length), playing.delays[index]);
    return () => clearTimeout(timer);
  }, [playing, index]);
  const image = playing?.images[index];
  if (chosen === "" || !image) return null;
  return <image source={image} fit="fit" style={{ width, height, flexShrink: 0 }} />;
}
