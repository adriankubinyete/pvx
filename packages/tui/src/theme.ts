/** Dark tokens from the spec ("Identidade visual"). Light theme: TBD (owner decision). */
export const theme = {
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

export type Theme = typeof theme;
