/** The only file with color literals. Dark tokens from the spec ("Identidade visual"). */
export const tokens = {
  bg: "#0e1013",
  panel: "#14171c",
  selected: "#1c2a26",
  border: "#262b33",
  text: "#e6e8eb",
  dim: "#8a919c",
  accent: "#6ee7b7",
  warn: "#ffb454",
  error: "#ff7a7a",
  info: "#7cc4ff",
  thirdParty: "#b78cff",
} as const;

export type Tokens = { -readonly [K in keyof typeof tokens]: string };
export type ThemeName = "dark" | "light";

/** Light theme is an owner decision still pending (contrast must be measured first). */
export function tokensFor(name: ThemeName): Tokens {
  if (name === "light") throw new Error("tema claro ainda não definido");
  return { ...tokens };
}

/** Axis 1: accent color. Replaces `accent` only. */
export const accents = { menta: tokens.accent, azul: tokens.info, ambar: tokens.warn, violeta: tokens.thirdParty } as const;
export type AccentName = keyof typeof accents;

/** Axis 2: symbols. Every glyph is one cell wide and has an ASCII fallback. */
export const glyphs = {
  unicode: {
    ok: "✓", warn: "▲", warnTag: "!", error: "✗", info: "i", active: "●", inactive: "○",
    meterFull: "▰", meterEmpty: "▱", prompt: "❯", query: "›", cursor: "»", spinner: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    core: "■", page: "§", official: "◆", thirdParty: "◇", dev: "↯", favorite: "★", corners: "╭╮╰╯", rule: "═", moreLeft: "‹", moreRight: "›",
  },
  ascii: {
    ok: "+", warn: "^", warnTag: "!", error: "x", info: "i", active: "*", inactive: "o",
    meterFull: "#", meterEmpty: "-", prompt: ">", query: ">", cursor: ">", spinner: "|/-\\",
    core: "=", page: "#", official: "O", thirdParty: "o", dev: "~", favorite: "*", corners: "++++", rule: "=", moreLeft: "<", moreRight: ">",
  },
} as const;
export type Symbols = keyof typeof glyphs;
/** `spinner` holds the animation frames, one cell each. */
export type Glyphs = { [K in keyof (typeof glyphs)["unicode"]]: string };

/** Axis 3: border style of panels. */
export type BorderName = "rounded" | "single" | "none";

/** Axis 4: result line format. `bracket` is the default. */
export type ResultFormat = "bracket" | "glyph" | "text";
export type ResultKind = "ok" | "warn" | "error" | "info";

const words: Record<ResultKind, string> = { ok: "sucesso", warn: "aviso", error: "erro", info: "info" };

/** Marker of a result line, e.g. `[✓]`, `✓` or `sucesso:`. Color it with the level color. */
export function resultMarker(kind: ResultKind, format: ResultFormat, g: Glyphs): string {
  const glyph = kind === "warn" && format === "bracket" ? g.warnTag : g[kind];
  return format === "bracket" ? `[${glyph}]` : format === "glyph" ? glyph : `${words[kind]}:`;
}
