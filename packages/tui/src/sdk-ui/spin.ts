import { useEffect, useState } from "react";
import { useTheme } from "../theme-context.tsx";

/** Milliseconds between two spinner frames. */
const FRAME_MS = 100;

/** The current spinner frame; it ticks (every 100 ms, like `Steps`) only while `active`. */
export function useSpin(active: boolean): string {
  const { g } = useTheme();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((count) => count + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, [active]);
  const frames = [...g.spinner];
  return frames[tick % frames.length]!;
}
