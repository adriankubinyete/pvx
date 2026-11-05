import { afterEach, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { TextArea } from "../src/sdk-ui/textarea.tsx";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const Area = TextArea as (p: Parameters<typeof TextArea>[0]) => ReactNode;

test("TextArea: a title in the border, the initial text, typing and backspace report the whole text", async () => {
  const seen: string[] = [];
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Area title="Nota" initial="olá" focused rows={3} onChange={(t) => void seen.push(t)} /></KeyRouter></ThemeProvider>, { cols: 40, rows: 8 });
  expect(h.frame()).toContain("Nota");
  expect(h.frame()).toContain("olá");
  await h.type(" mundo");
  await h.press("BACKSPACE");
  await h.press("RETURN");
  await h.type("fim");
  expect(seen.at(-1)).toBe("olá mund\nfim");
  expect(h.frame()).toContain("fim");
});

test("TextArea without focus takes no key", async () => {
  const seen: string[] = [];
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Area initial="a" onChange={(t) => void seen.push(t)} /></KeyRouter></ThemeProvider>, { cols: 40, rows: 8 });
  await h.type("xyz");
  expect(seen).toEqual([]);
});
