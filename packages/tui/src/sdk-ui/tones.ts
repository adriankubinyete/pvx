import type { Tone } from "@pvx/sdk";
import type { Tokens } from "../theme.ts";

/** The theme color of every tone a module can ask for. One table for the whole kit. */
export const toneColor = (c: Tokens, tone: Tone = "text"): string => {
  const colors: Record<Tone, string> = { ok: c.accent, warn: c.warn, error: c.error, info: c.info, accent: c.accent, dim: c.dim, text: c.text, ip: c.ip };
  return colors[tone];
};
