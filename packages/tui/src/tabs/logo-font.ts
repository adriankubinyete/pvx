/** The block letters of the mark: five rows, seven cells wide, strokes two cells thick. */
const GLYPHS: Record<string, readonly string[]> = {
  P: ["██████ ", "██   ██", "██████ ", "██     ", "██     "],
  H: ["██   ██", "██   ██", "███████", "██   ██", "██   ██"],
  O: [" █████ ", "██   ██", "██   ██", "██   ██", " █████ "],
  N: ["███   █", "████  █", "██ ██ █", "██  ███", "██   ██"],
  E: ["███████", "██     ", "█████  ", "██     ", "███████"],
  V: ["██   ██", "██   ██", "██   ██", " ██ ██ ", "  ███  "],
  X: ["██   ██", " ██ ██ ", "  ███  ", " ██ ██ ", "██   ██"],
  G: [" █████ ", "██     ", "██  ███", "██   ██", " █████ "],
  R: ["██████ ", "██   ██", "██████ ", "██  ██ ", "██   ██"],
  U: ["██   ██", "██   ██", "██   ██", "██   ██", " █████ "],
  T: ["███████", "  ███  ", "  ███  ", "  ███  ", "  ███  "],
  C: [" ██████", "██     ", "██     ", "██     ", " ██████"],
  L: ["██     ", "██     ", "██     ", "██     ", "███████"],
  Y: ["██   ██", " ██ ██ ", "  ███  ", "  ███  ", "  ███  "],
};

/** Cells between two letters, and the blank between two words (besides the gap of the letters beside it). */
const LETTER_GAP_W = 2;
const WORD_GAP_W = 5;
const ROWS = 5;

/** `text` in block letters: five rows, the letters `LETTER_GAP_W` apart, the words `WORD_GAP_W` more apart. A character with no glyph throws. */
export function renderText(text: string): string[] {
  const rows = Array.from({ length: ROWS }, () => "");
  [...text.toUpperCase()].forEach((char, index) => {
    if (char === " ") return void rows.forEach((_, r) => (rows[r] += " ".repeat(WORD_GAP_W)));
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`sem glifo para "${char}"`);
    rows.forEach((_, r) => (rows[r] += (index > 0 ? " ".repeat(LETTER_GAP_W) : "") + glyph[r]));
  });
  return rows.map((row) => row.trimEnd());
}
