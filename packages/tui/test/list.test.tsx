import { afterEach, beforeEach, expect, test } from "bun:test";
import { useState, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { ListColumn, ListItem } from "@pvx/sdk";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { ThemeProvider } from "../src/index.ts";
import { marquee, marqueeOffset } from "../src/sdk-ui/columns.ts";
import { List } from "../src/sdk-ui/kit.tsx";

type Props = Parameters<typeof List>[0];
const ListView = List as (p: Props) => ReactNode; // `Component` returns unknown, which JSX rejects
let h: TuiHarness | undefined;
const saved = { ...marquee };
beforeEach(() => Object.assign(marquee, { pauseMs: 40, stepMs: 20 }));
afterEach(() => (h?.destroy(), Object.assign(marquee, saved)));

const columns: ListColumn[] = [
  { id: "ip", title: "IP", width: 18 },
  { id: "state", title: "ESTADO", width: 10 },
  { id: "note", title: "NOTA", grow: 1 },
];
const items: ListItem[] = [
  { id: "a", cells: { ip: "189.124.85.152/29", state: "aceito", note: "PHONEVOX REDE" } },
  { id: "b", cells: { ip: "179.199.136.199", state: { text: "aceito", tone: "ok" }, note: "MAGNUSBILLING PHONEVOX MUITO LONGO NOTA" } },
  { id: "c", cells: { ip: "192.168.1.1", state: "bloqueado", note: "teste" } },
];

/** Arrow down/up moves the selection; `focus` false passes no selection. */
function Harness({ rows = items, cols = columns as ListColumn[] | null, start = "a" }: { rows?: ListItem[]; cols?: ListColumn[] | null; start?: string | null }) {
  const [sel, setSel] = useState<string | undefined>(start ?? undefined);
  useKeyboard((k) => {
    if (k.name === "down") setSel((s) => rows[Math.min(rows.length - 1, rows.findIndex((r) => r.id === s) + 1)]!.id);
    if (k.name === "x") setSel(undefined);
  });
  return <ListView items={rows} columns={cols ?? undefined} selected={sel} />;
}
async function mount(cols = 60, el: ReactNode = <Harness />) {
  h = await renderTui(<ThemeProvider>{el}</ThemeProvider>, { cols, rows: 12 });
  await h.flush();
  return h;
}
const lines = (t: TuiHarness) => t.frame().split("\n").map((l) => l.trimEnd()).filter(Boolean);
const rowOf = (t: TuiHarness, text: string) => lines(t).find((l) => l.includes(text))!;
async function until(t: TuiHarness, pred: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; !pred() && Date.now() < end; ) (await Bun.sleep(10), await t.flush());
  return pred();
}

test("columns align across rows of different lengths and the header shows", async () => {
  const t = await mount();
  const l = lines(t);
  expect(l[0]).toMatch(/^ {2}IP {18}ESTADO {6}NOTA$/);
  const col = (line: string, word: string) => line.indexOf(word);
  expect(col(rowOf(t, "189.124"), "aceito")).toBe(col(l[0]!, "ESTADO") );
  expect(col(rowOf(t, "179.199"), "aceito")).toBe(col(l[0]!, "ESTADO"));
  expect(col(rowOf(t, "192.168"), "bloqueado")).toBe(col(l[0]!, "ESTADO"));
  expect(col(rowOf(t, "192.168"), "teste")).toBe(col(l[0]!, "NOTA"));
  expect(rowOf(t, "189.124")).toMatch(/^[^ ] 189/); // cursor marker on the selected row
});

test("no header row when no column has a title", async () => {
  const t = await mount(60, <Harness cols={columns.map(({ title: _, ...c }) => c)} />);
  expect(lines(t)).toHaveLength(3);
});

test("a cell that does not fit is cut with an ellipsis; fixed columns keep their width", async () => {
  const t = await mount(50, <Harness start={null} />);
  // 50 - 2 lead - 18 - 10 - 4 gaps = 16 cells for the grow column
  const row = rowOf(t, "179.199");
  expect(row).toContain("MAGNUSBILLING P…");
  expect(row.indexOf("aceito")).toBe(lines(t)[0]!.indexOf("ESTADO"));
});

test("right aligned cells end on the same column", async () => {
  const cols: ListColumn[] = [{ id: "ip", width: 20 }, { id: "n", width: 6, align: "right" }];
  const rows: ListItem[] = [{ id: "a", cells: { ip: "x", n: "1" } }, { id: "b", cells: { ip: "yy", n: "1234" } }];
  const t = await mount(40, <Harness rows={rows} cols={cols} />);
  expect(rowOf(t, "yy").length).toBe(rowOf(t, "x").length);
  expect(rowOf(t, "1234").endsWith("1234")).toBe(true);
});

test("marquee: the selected row's long cell scrolls and returns; other rows never move", async () => {
  const t = await mount(50, <Harness start="b" />);
  const start = rowOf(t, "179.199");
  expect(start).toContain("MAGNUSBILLING P…");
  const untouched = [rowOf(t, "189.124"), rowOf(t, "192.168")];
  expect(await until(t, () => rowOf(t, "179.199") !== start)).toBe(true);
  expect(await until(t, () => rowOf(t, "179.199").includes("LONGO NOTA"))).toBe(true); // end visible, no ellipsis
  expect(rowOf(t, "179.199")).not.toContain("…");
  expect([rowOf(t, "189.124"), rowOf(t, "192.168")]).toEqual(untouched);
  expect(await until(t, () => rowOf(t, "179.199") === start)).toBe(true);
});

test("moving the selection resets the previous row and starts the new one", async () => {
  const rows: ListItem[] = [
    { id: "a", cells: { ip: "first row that is far too long for it", state: "x", note: "n" } },
    { id: "b", cells: { ip: "second row that is far too long also", state: "x", note: "n" } },
  ];
  const cols: ListColumn[] = [{ id: "ip", width: 12 }, { id: "state", width: 3 }, { id: "note", width: 3 }];
  const t = await mount(40, <Harness rows={rows} cols={cols} />);
  const body = (s: string) => s.slice(2); // drop the cursor column
  const a0 = rowOf(t, "first");
  expect(await until(t, () => rowOf(t, "first") !== a0)).toBe(true);
  await t.press("ARROW_DOWN");
  expect(body(rowOf(t, "first"))).toBe(body(a0));
  const b0 = rowOf(t, "second");
  expect(await until(t, () => rowOf(t, "second") !== b0)).toBe(true);
  expect(body(rowOf(t, "first"))).toBe(body(a0));
  await t.press("x"); // no selection: nothing scrolls and everything is truncated again
  await Bun.sleep(150);
  await t.flush();
  expect(body(rowOf(t, "first"))).toBe(body(a0));
  expect(body(rowOf(t, "second"))).toBe(body(b0));
});

test("marqueeOffset: pauses at both ends, one cell per step, then back", () => {
  const seq = Array.from({ length: 14 }, (_, i) => marqueeOffset(i, 3, 2));
  expect(seq).toEqual([0, 0, 1, 2, 3, 3, 3, 2, 1, 0, 0, 0, 1, 2]);
  expect(marqueeOffset(5, 0, 2)).toBe(0);
});

test("legacy label items render as before", async () => {
  const rows: ListItem[] = [
    { id: "a", label: "primeiro", detail: "d1", mark: { text: "●", tone: "ok" } },
    { id: "b", label: "segundo" },
  ];
  const t = await mount(40, <Harness rows={rows} cols={null} />);
  const l = lines(t);
  expect(l).toHaveLength(2);
  expect(l[0]!.slice(2)).toBe("● primeiro  d1");
  expect(l[1]!.slice(2)).toBe("  segundo");
});

test("mouse: hover tints the row under the pointer (not the selected one) and reports it; press reports the row id", async () => {
  const seen: (string | undefined)[] = [];
  const pressed: string[] = [];
  const t = await mount(60, <ListView items={items} columns={columns} selected="a" onHover={(id) => seen.push(id)} onPress={(id) => pressed.push(id)} />);
  const y = (text: string) => t.frame().split("\n").findIndex((l) => l.includes(text));
  expect(rowOf(t, "192.168")).toMatch(/^ {2}192/);
  await t.hover(10, y("192.168"));
  await t.flush();
  expect(rowOf(t, "192.168")).toMatch(/^› 192/); // hover cue, distinct from the selected "»"
  expect(rowOf(t, "189.124")).toMatch(/^» 189/); // selection untouched
  expect(seen.at(-1)).toBe("c");
  await t.hover(10, y("189.124")); // over the selected row: no hover cue
  await t.flush();
  expect(rowOf(t, "189.124")).toMatch(/^» 189/);
  expect(rowOf(t, "192.168")).toMatch(/^ {2}192/);
  await t.click(10, y("179.199"));
  expect(pressed).toEqual(["b"]);
});
