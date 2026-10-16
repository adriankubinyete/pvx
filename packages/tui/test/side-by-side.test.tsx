// Sections side by side keep a breathing room: a cut `…` never touches the neighbor's gutter.
import { afterEach, expect, test } from "bun:test";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { ThemeProvider } from "../src/index.ts";
import { List, Panel, Row, SECTION_GAP_W } from "../src/sdk-ui/kit.tsx";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const LONG_COMMENT = "placeholder comment that is far too long to fit in its column ".repeat(4);
const columns = [{ id: "ip", title: "ip", width: 16 }, { id: "note", title: "nota", grow: 1 }];
const items = [{ id: "a", cells: { ip: "198.51.100.7", note: LONG_COMMENT } }, { id: "b", cells: { ip: "203.0.113.9", note: LONG_COMMENT } }];

for (const [cols, rows] of [[120, 40], [160, 40]] as const) {
  test(`side-by-side sections keep ${SECTION_GAP_W} blank cells between the list text and the next gutter at ${cols}x${rows}`, async () => {
    h = await renderTui(
      <ThemeProvider>
        <Row>
          <Panel title="IPs"><List items={items} columns={columns} selected="a" /></Panel>
          <Panel title="Portas" tone="accent"><List items={items} columns={columns} selected="a" /></Panel>
        </Row>
      </ThemeProvider>,
      { cols, rows },
    );
    await h.flush();
    await h.flush();
    const line = h.frame().split("\n").find((row) => row.includes("198.51.100.7"))!;
    const gutter = line.indexOf("▌");
    const cut = line.indexOf("…");
    expect(cut).toBeGreaterThan(0);
    expect(gutter).toBeGreaterThan(cut);
    expect(gutter - (cut + 1)).toBeGreaterThanOrEqual(SECTION_GAP_W);
  });
}
