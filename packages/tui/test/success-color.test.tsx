import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { RGBA } from "@opentui/core";
import { pvxHome } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { CellGrid } from "../src/sdk-ui/flow.tsx";
import { Notice, Steps } from "../src/sdk-ui/kit.tsx";
import { accentFor, hexTokensFor, THEME_NAMES, tokensFor } from "../src/theme.ts";

// Success and done are the success token, never the accent: with a blue accent a finished item must not look like a running one (UI.md, section 2).

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const Grid = CellGrid as (props: Parameters<typeof CellGrid>[0]) => ReactNode;
const Steplist = Steps as (props: Parameters<typeof Steps>[0]) => ReactNode;
const Note = Notice as (props: Parameters<typeof Notice>[0]) => ReactNode;

const BLUE = accentFor("dark", "azul")!;
const dark = hexTokensFor("dark")!;

/** Renders `element` with the accent preset set to blue, the way the Sistema tab saves it. */
async function renderWithBlueAccent(element: ReactNode) {
  const statePath = join(pvxHome(), "blue.json");
  writeFileSync(statePath, JSON.stringify({ accent: "azul" }));
  h = await renderTui(<ThemeProvider statePath={statePath}><KeyRouter onQuit={() => {}}>{element}</KeyRouter></ThemeProvider>, { cols: 60, rows: 12 });
  return h;
}

/** The foreground of the first span that holds `text`. */
function colorOf(t: TuiHarness, text: string): RGBA {
  for (const line of t.spans().lines) {
    const span = line.spans.find((candidate) => candidate.text.includes(text));
    if (span) return span.fg;
  }
  throw new Error(`"${text}" has no span in:\n${t.frame()}`);
}

test("every theme has the success token; in the dark theme with the default accent it is the same green", () => {
  for (const name of THEME_NAMES) expect(tokensFor(name).ok, name).toBeDefined();
  expect(dark.ok).toBe(dark.accent);
  expect(hexTokensFor("light")!.ok).toBe("#0a6b4a");
});

test("CellGrid with a blue accent: done cells are the success color, running ones the info blue, and the legend says the same", async () => {
  const t = await renderWithBlueAccent(<Grid cells={[{ id: "a", state: "done" }, { id: "b", state: "running" }]} focused={false} />);
  // The legend glyphs come first (done, running), then the cells (done, running).
  const marks = t.spans().lines.flatMap((line) => line.spans).filter((span) => span.text.includes("■")).map((span) => span.fg);
  expect(marks).toHaveLength(4);
  const [legendDone, legendRunning, cellDone, cellRunning] = marks as [RGBA, RGBA, RGBA, RGBA];
  for (const done of [legendDone, cellDone]) {
    expect(done.equals(RGBA.fromHex(dark.ok))).toBe(true);
    expect(done.equals(RGBA.fromHex(BLUE))).toBe(false); // not the blue accent
  }
  for (const running of [legendRunning, cellRunning]) expect(running.equals(cellDone)).toBe(false);
});

test("Steps with a blue accent: the done mark and word are the success color, the running ones are not", async () => {
  const t = await renderWithBlueAccent(<Steplist items={[{ id: "a", label: "lorem", state: "done" }, { id: "b", label: "ipsum", state: "running" }]} />);
  const done = colorOf(t, "✓");
  expect(done.equals(RGBA.fromHex(dark.ok))).toBe(true);
  expect(done.equals(RGBA.fromHex(BLUE))).toBe(false);
  expect(colorOf(t, "rodando").equals(done)).toBe(false);
});

test("Notice [✓] with a blue accent is the success color, [i] stays the info blue", async () => {
  const t = await renderWithBlueAccent(<><Note level="ok">lorem</Note><Note level="info">ipsum</Note></>);
  expect(colorOf(t, "[✓]").equals(RGBA.fromHex(dark.ok))).toBe(true);
  expect(colorOf(t, "[✓]").equals(RGBA.fromHex(BLUE))).toBe(false);
  expect(colorOf(t, "[i]").equals(colorOf(t, "[✓]"))).toBe(false);
});
