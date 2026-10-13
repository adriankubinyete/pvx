import { expect, test } from "bun:test";
import { ACCENT_NAMES, accents, applyAccent, blend, contrast, hexTokensFor, lowContrast, normalizeHex, SURFACES, TEXT_TOKENS, tokensFor, type HexTokens } from "../src/theme.ts";
import { defaultTuiState } from "@pvx/core";

test("WCAG contrast: black on white is 21:1, same colour is 1:1", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#336699", "#336699")).toBeCloseTo(1, 5);
});

test("every text token reaches the minimum on bg, panel and selected: 4.5:1 in Claro, 7:1 in Alto contraste (4.5:1 in Escuro)", () => {
  for (const [name, min] of [["dark", 4.5], ["light", 4.5], ["contrast", 7]] as const) {
    const t = hexTokensFor(name)!;
    for (const k of TEXT_TOKENS) for (const s of SURFACES) expect(contrast(t[k], t[s]), `${name} ${k} on ${s}`).toBeGreaterThanOrEqual(min);
  }
});

test("hex validation: #rgb and #rrggbb in any case are normalized; anything else is rejected", () => {
  expect(normalizeHex("#ABC")).toBe("#aabbcc");
  expect(normalizeHex(" #6EE7B7 ")).toBe("#6ee7b7");
  for (const bad of ["", "6ee7b7", "#12", "#12345", "#1234567", "#ggg000", "red", "#00000000"]) expect(normalizeHex(bad), bad).toBeNull();
});

test("custom theme: valid entries override dark, invalid ones are ignored; terminal has no hex", () => {
  const t = hexTokensFor("custom", { bg: "#fff", text: "nope", accent: "#123456" })!;
  expect(t.bg).toBe("#ffffff");
  expect(t.text).toBe(hexTokensFor("dark")!.text);
  expect(t.accent).toBe("#123456");
  expect(hexTokensFor("terminal")).toBeNull();
  expect(tokensFor("terminal").bg).not.toBe(tokensFor("dark").bg);
});

test("lowContrast lists the text tokens under 4.5:1 on bg", () => {
  const t = { ...hexTokensFor("dark")!, dim: "#1a1a1a" };
  expect(lowContrast(t).map((x) => x.key)).toEqual(["dim"]);
  expect(lowContrast(hexTokensFor("light")!)).toEqual([]);
});

test("blend: ratio 0 keeps the base, 1 gives the top colour, in between rounds per channel", () => {
  expect(blend("#ffffff", "#000000", 0)).toBe("#000000");
  expect(blend("#ffffff", "#000000", 1)).toBe("#ffffff");
  expect(blend("#6ee7b7", "#0e1013", 0.12)).toBe("#1a2a27");
});

test("applyAccent: built-in themes tint selected with the effective accent; default accent is the theme's own", () => {
  const dark = tokensFor("dark");
  expect(applyAccent("dark", dark, "tema").accent).toBe(dark.accent);
  expect(applyAccent("dark", dark, "tema").selected).toBe("#1a2a27");
  expect(applyAccent("light", tokensFor("light"), "tema").selected).toBe("#d3e2df");
  expect(applyAccent("contrast", tokensFor("contrast"), "tema").selected).toBe("#071f15");
  const azul = applyAccent("dark", dark, "azul");
  expect(azul.accent).toBe(accents.azul);
  expect(azul.selected).not.toBe(applyAccent("dark", dark, "menta").selected);
});

test("applyAccent: the selected tint keeps every text token readable with every accent preset", () => {
  for (const [name, min] of [["dark", 4.5], ["light", 4.5], ["contrast", 7]] as const) {
    const base = tokensFor(name) as HexTokens;
    for (const acc of ["tema", ...ACCENT_NAMES]) {
      const t = applyAccent(name, base, acc) as HexTokens;
      for (const k of TEXT_TOKENS) expect(contrast(t[k], t.selected), `${name} ${acc} ${k}`).toBeGreaterThanOrEqual(min);
    }
  }
});

test("applyAccent: custom keeps its own selected; terminal is untouched but for the accent", () => {
  const custom = tokensFor("custom", { selected: "#123456" });
  expect(applyAccent("custom", custom, "azul").selected).toBe("#123456");
  expect(applyAccent("custom", custom, "tema").accent).toBe(custom.accent);
  const term = tokensFor("terminal");
  expect(applyAccent("terminal", term, "tema").selected).toBe(term.selected);
});

test("the default accent axis is \"tema\": each theme keeps its own accent", () => {
  expect(defaultTuiState().accent).toBe("tema");
});
