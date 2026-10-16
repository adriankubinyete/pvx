// Frame: a section with a single border and its title in the top border.
import { afterEach, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { RGBA } from "@opentui/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { ThemeProvider, useTheme } from "../src/index.ts";
import { Frame, Row, Text } from "../src/sdk-ui/kit.tsx";
import { glyphs } from "../src/theme.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const FrameView = Frame as (props: Parameters<typeof Frame>[0]) => ReactNode;
const RowView = Row as (props: Parameters<typeof Row>[0]) => ReactNode;
const TextView = Text as (props: Parameters<typeof Text>[0]) => ReactNode;

const SIZES = [{ cols: 80, rows: 24 }, { cols: 120, rows: 40 }] as const;

/** The color of the first span that holds `text`, read back as a hex string. */
function colorOf(text: string, nth = 0): RGBA {
  const spans = h!.spans().lines.flatMap((line) => line.spans);
  return spans.filter((span) => span.text.includes(text))[nth]!.fg;
}

function Themed({ children }: { children: (accent: string, faint: string) => ReactNode }) {
  const { c } = useTheme();
  return <>{children(c.accent.toString(), c.border.toString())}</>;
}

for (const size of SIZES) {
  test(`active and inactive Frame at ${size.cols}x${size.rows}`, async () => {
    h = await renderTui(
      <ThemeProvider>
        <Themed>{(accent, faint) => (
          <>
            <FrameView title="1 Status" aside="13" active><TextView>lorem ipsum</TextView></FrameView>
            <FrameView title="2 IPs"><TextView>dolor sit</TextView></FrameView>
            <TextView>{`${accent} ${faint}`}</TextView>
          </>
        )}</Themed>
      </ThemeProvider>,
      size,
    );
    await h.flush();
    await h.flush();
    const lines = h.frame().split("\n");
    expect(lines[0]).toStartWith("╭─ 1 Status ");
    expect(lines[0]).toContain(" 13 ─╮");
    expect(lines[1]).toStartWith("│ lorem ipsum");
    expect(lines[2]).toStartWith("╰");
    const [accent, faint] = lines.find((line) => line.includes("#"))!.trim().split(" ");
    expect(colorOf("1 Status").equals(RGBA.fromHex(accent!))).toBe(true);
    expect(colorOf("2 IPs").equals(RGBA.fromHex(accent!))).toBe(false);
    expect(colorOf("╭─ ", 0).equals(RGBA.fromHex(accent!))).toBe(true);
    expect(colorOf("╭─ ", 1).equals(RGBA.fromHex(faint!))).toBe(true);
  });
}

test("two Frames side by side keep a 3-cell gap, an empty Frame still draws", async () => {
  h = await renderTui(
    <ThemeProvider>
      <RowView>
        <FrameView title="2 IPs" aside="0" />
        <FrameView title="3 Portas"><TextView>lorem</TextView></FrameView>
      </RowView>
    </ThemeProvider>,
    { cols: 120, rows: 40 },
  );
  await h.flush();
  await h.flush();
  const top = h.frame().split("\n")[0]!;
  expect(top).toMatch(/╮ {3,}╭─ 3 Portas/);
  expect(h.frame().split("\n")[1]).toContain("│");
});

test("moving focus between Frames moves the accent border", async () => {
  const pick = async (first: boolean) => {
    h?.destroy();
    h = await renderTui(
      <ThemeProvider>
        <FrameView title="1 Lorem" active={first}><TextView>a</TextView></FrameView>
        <FrameView title="2 Ipsum" active={!first}><TextView>b</TextView></FrameView>
      </ThemeProvider>,
      { cols: 80, rows: 24 },
    );
    await h.flush();
    await h.flush();
    return [colorOf("╭─ ", 0), colorOf("╭─ ", 1)];
  };
  const [firstA, secondA] = await pick(true);
  const [firstB, secondB] = await pick(false);
  expect(firstA!.equals(secondB!)).toBe(true);
  expect(secondA!.equals(firstB!)).toBe(true);
  expect(firstA!.equals(secondA!)).toBe(false);
});

test("every frame glyph takes one cell in the unicode set", () => {
  const drawn = [...glyphs.unicode.corners, glyphs.unicode.hline, glyphs.unicode.sepBar];
  for (const glyph of drawn) expect(Bun.stringWidth(glyph)).toBe(1);
});

test("a Frame inside a Frame is refused", async () => {
  const nested = (
    <ThemeProvider>
      <FrameView title="1 Lorem"><FrameView title="2 Ipsum"><TextView>a</TextView></FrameView></FrameView>
    </ThemeProvider>
  );
  h = await renderTui(nested, { cols: 80, rows: 24 });
  await h.flush();
  expect(h.frame()).not.toContain("2 Ipsum");
});
