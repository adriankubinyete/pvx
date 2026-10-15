import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createLogger, createRegistry, logsDir, pvxHome } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs } from "../src/index.ts";
import { barVersion } from "../src/tabs/bar.ts";
import { clockCost, clockText, clockWidth, pickForm } from "../src/tabs/clock.tsx";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

let renders = 0;
async function mount(cols: number, now: () => number) {
  const registry = createRegistry();
  registry.register({ id: "m", version: "1", entry: "x" }, {
    pages: { p: { title: "p", tab: true, render: () => (renders++, null) } },
  });
  const makeLogger = (n: string) => createLogger(logsDir(), n);
  const store = createSessionStore({ registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history") });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={now} /> };
  h = await renderTui(<App root={root} logger={quiet} onExit={() => {}} statePath={join(pvxHome(), "s.json")} pages={{ session: store, registry, makeLogger }} />, { cols, rows: 24 });
  return h;
}
const D = new Date(2026, 9, 8, 14, 32, 7).getTime(); // a Thursday

test("the clock drops the date, then the seconds, then the time itself", () => {
  const d = new Date(D);
  expect(["full", "time", "short", "none"].map((f) => clockText(d, f as never))).toEqual(["qui 08/10 14:32:07", "14:32:07", "14:32", ""]);
  expect(pickForm(clockCost("full"))).toBe("full");
  expect(pickForm(clockCost("full") - 1)).toBe("time");
  expect(pickForm(clockCost("time") - 1)).toBe("short");
  expect(pickForm(clockCost("short") - 1)).toBe("none");
  expect(pickForm(0)).toBe("none");
  expect(clockWidth("none")).toBe(0);
});

test("the bar shows a dev build as `dev +N` (the count of embedded modules) and leaves any other label alone", () => {
  expect(barVersion("0.1.2 (dev, +alpha +beta +gamma)")).toBe("0.1.2 dev +3");
  expect(barVersion("0.1.2 (dev)")).toBe("0.1.2 dev");
  expect(barVersion("0.1.2 (nightly, abc1234)")).toBe("0.1.2 (nightly, abc1234)");
  expect(barVersion("0.1.0")).toBe("0.1.0");
});

test("the bar shows clock and version at 80 columns with the current tabs", async () => {
  const t = await mount(80, () => D);
  const bar = t.frame().split("\n")[0]!;
  expect(bar).toContain("│ qui 08/10 14:32:07 · pvx 0.1.0");
  expect(bar.length).toBeLessThanOrEqual(80);
});

for (const cols of [80, 100, 120]) {
  test(`a thin rule runs under the bar across the page width (${cols} columns)`, async () => {
    const t = await mount(cols, () => D);
    const rule = t.frame().split("\n")[1]!;
    expect(rule.trim()).toBe("─".repeat(cols - 2));
  });
}

test("a clock tick re-renders only the clock: the tab content does not render again", async () => {
  const start = Date.now();
  const t = await mount(100, () => D + (Date.now() - start));
  await t.press("TAB"); // the module tab
  await t.flush();
  const before = renders;
  const text = (f: string) => /\d\d:\d\d:(\d\d)/.exec(f.split("\n")[0]!)![1];
  const s0 = text(t.frame());
  await Bun.sleep(2300);
  await t.flush();
  expect(text(t.frame())).not.toBe(s0); // it ticked
  expect(renders).toBe(before); // and nothing else rendered
});
