import { RGBA } from "@opentui/core";

/** The only file with color literals. Dark tokens from the spec ("Identidade visual"). */
export const tokens = {
  bg: "#0e1013",
  panel: "#14171c",
  selected: "#1c2a26",
  border: "#262b33",
  text: "#e6e8eb",
  dim: "#8a919c",
  accent: "#6ee7b7",
  ok: "#6ee7b7",
  warn: "#ffb454",
  error: "#ff7a7a",
  info: "#7cc4ff",
  thirdParty: "#b78cff",
  ip: "#f07fb0",
} as const;

export type TokenKey = keyof typeof tokens;
export const TOKEN_KEYS = Object.keys(tokens) as TokenKey[];
/**
 * Typed as strings so every `fg`/`bg` prop keeps its type. The terminal theme stores `RGBA` objects here (default and ANSI
 * palette intent, which a hex string cannot carry); OpenTUI takes both. Never do string work on a token: use `HexTokens`.
 */
export type Tokens = Record<TokenKey, string>;
export type HexTokens = Record<TokenKey, string>;
export type ThemeName = "dark" | "light" | "contrast" | "terminal" | "custom";
export const THEME_NAMES: readonly ThemeName[] = ["dark", "light", "contrast", "terminal", "custom"];
/** Tokens drawn as text: each must reach 4.5:1 on `bg`. */
export const TEXT_TOKENS: readonly TokenKey[] = ["text", "dim", "accent", "ok", "warn", "error", "info", "thirdParty", "ip"];
/** Backgrounds a text token can land on. */
export const SURFACES: readonly TokenKey[] = ["bg", "panel", "selected"];

const hexThemes = {
  dark: { ...tokens } as HexTokens,
  // Same roles on a light ground; every text token is >= 4.5:1 on bg, panel and selected (see theme.test.ts).
  light: {
    bg: "#f6f7f9", panel: "#ffffff", selected: "#d9efe4", border: "#c4cad3",
    text: "#1b1f24", dim: "#505a66", accent: "#0a6b4a", ok: "#0a6b4a", warn: "#7d4a00", error: "#b3261e", info: "#0b5394", thirdParty: "#6a3dbd", ip: "#a3195b",
  } as HexTokens,
  // Pure black and white; text tokens >= 7:1 on every surface.
  contrast: {
    bg: "#000000", panel: "#0a0a0a", selected: "#161616", border: "#a0a0a0",
    text: "#ffffff", dim: "#c4c4c4", accent: "#3dffb0", ok: "#3dffb0", warn: "#ffd60a", error: "#ff8080", info: "#6cc9ff", thirdParty: "#d4a5ff", ip: "#ff9ccc",
  } as HexTokens,
};
export type HexThemeName = keyof typeof hexThemes;

/** No colours of its own: the terminal's default fg/bg and its ANSI palette (green accent, yellow warn, red error, blue info, magenta ip, bright black dim). */
const terminal = {
  bg: RGBA.defaultBackground(), panel: RGBA.defaultBackground(), selected: RGBA.defaultBackground(), border: RGBA.fromIndex(8),
  text: RGBA.defaultForeground(), dim: RGBA.fromIndex(8), accent: RGBA.fromIndex(2), ok: RGBA.fromIndex(2), warn: RGBA.fromIndex(3), error: RGBA.fromIndex(1), info: RGBA.fromIndex(4), thirdParty: RGBA.fromIndex(5), ip: RGBA.fromIndex(13),
} as unknown as Tokens;

/** `#rgb` or `#rrggbb` (any case) to `#rrggbb` lowercase; `null` if it is neither. */
export function normalizeHex(s: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((x) => x + x).join("") : h}`;
}

const channel = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Hex values of a theme; `null` for `terminal`, whose colours come from the terminal. A custom theme starts from dark; invalid entries are ignored. */
export function hexTokensFor(name: ThemeName, custom: Record<string, string> = {}): HexTokens | null {
  if (name === "terminal") return null;
  if (name !== "custom") return { ...hexThemes[name] };
  const out = { ...hexThemes.dark };
  for (const k of TOKEN_KEYS) out[k] = normalizeHex(custom[k] ?? "") ?? out[k];
  return out;
}

export function tokensFor(name: ThemeName, custom: Record<string, string> = {}): Tokens {
  return hexTokensFor(name, custom) ?? { ...terminal };
}

/** Text tokens below 4.5:1 on `bg`, with their ratio. */
export function lowContrast(t: HexTokens): { key: TokenKey; ratio: number }[] {
  return TEXT_TOKENS.map((key) => ({ key, ratio: contrast(t[key], t.bg) })).filter((x) => x.ratio < 4.5);
}

/** Axis 1: accent color. Replaces `accent` only. */
export const accents = { menta: tokens.accent, azul: tokens.info, ambar: tokens.warn, roxo: tokens.thirdParty } as const;
/** The same presets, darkened to read on a light ground. */
const lightAccents: Record<AccentName, string> = { menta: "#0a6b4a", azul: "#0b5394", ambar: "#7d4a00", roxo: "#6a3dbd" };
export type AccentName = keyof typeof accents;
export const ACCENT_NAMES = Object.keys(accents) as AccentName[];

/** The preset's colour for the theme, or `undefined` for "do tema" (any name that is not a preset). */
export function accentFor(theme: ThemeName, name: string): string | undefined {
  if (!Object.hasOwn(accents, name)) return undefined;
  return (theme === "light" ? lightAccents : accents)[name as AccentName];
}

/** `top` laid over `under` at `ratio` (0 to 1), both `#rrggbb`; the result is `#rrggbb`. */
export function blend(top: string, under: string, ratio: number): string {
  const a = parseInt(top.slice(1), 16), b = parseInt(under.slice(1), 16);
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * ratio + ((b >> shift) & 255) * (1 - ratio));
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Share of the accent in `selected`, low enough to keep every text token readable on it with any accent preset. */
const SELECTED_MIX = { dark: 0.12, light: 0.15, contrast: 0.12 } as const;

/** The theme's tokens with the accent axis applied. Built-in themes tint `selected` with the effective accent; terminal and custom keep their own. */
export function applyAccent(theme: ThemeName, base: Tokens, name: string): Tokens {
  const accent = accentFor(theme, name) ?? base.accent;
  const out: Tokens = { ...base, accent };
  if (theme in SELECTED_MIX) out.selected = blend(accent, base.bg, SELECTED_MIX[theme as keyof typeof SELECTED_MIX]);
  return out;
}

/** Axis 2: symbols. Every glyph is one cell wide and has an ASCII fallback. */
export const glyphs = {
  unicode: {
    ok: "✓", warn: "▲", warnTag: "!", error: "✗", info: "i", active: "●", inactive: "○",
    meterFull: "▰", meterEmpty: "▱", prompt: "❯", shell: "$", query: "›", cursor: "»", spinner: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    core: "■", page: "§", official: "◆", thirdParty: "◇", dev: "↯", favorite: "★", corners: "╭╮╰╯", rule: "═", moreLeft: "‹", moreRight: "›",
    hline: "─", sep: "·", down: "↓", up: "↑", blocks: "▁▂▃▄▅▆▇█", braille: "1", barFull: "━", barEmpty: "─", progressFull: "█", progressEmpty: "░", cellOn: "■", cellOff: "■", gutter: "▌", mask: "•", radioOn: "•", sepBar: "│", auto: "◌",
  },
  ascii: {
    ok: "+", warn: "^", warnTag: "!", error: "x", info: "i", active: "*", inactive: "o",
    meterFull: "#", meterEmpty: "-", prompt: ">", shell: "$", query: ">", cursor: ">", spinner: "|/-\\",
    core: "=", page: "#", official: "O", thirdParty: "o", dev: "~", favorite: "*", corners: "++++", rule: "=", moreLeft: "<", moreRight: ">",
    hline: "-", sep: "-", down: "v", up: "^", blocks: "_.-:=+*#", braille: "", barFull: "=", barEmpty: "-", progressFull: "#", progressEmpty: ".", cellOn: "#", cellOff: ".", gutter: "|", mask: "*", radioOn: "*", sepBar: "|", auto: "~",
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
