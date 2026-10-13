import { expect, test } from "bun:test";
import { contrast, hexTokensFor, lowContrast, normalizeHex, SURFACES, TEXT_TOKENS, tokensFor } from "../src/theme.ts";

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
