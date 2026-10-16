// On a very wide terminal nothing sits far from its content: columns take their content width, right-aligned things align to the readable content width, and form buttons stay together.
import { afterEach, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { CONTENT_MAX_W } from "../src/layout.ts";
import { Fields } from "../src/sdk-ui/fields.tsx";
import { List, Panel, Row, Text } from "../src/sdk-ui/kit.tsx";
import { COLUMN_MAX_W, columnWidths } from "../src/sdk-ui/columns.ts";

const SIZE = { cols: 250, rows: 40 };
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const lineWith = (text: string): string => h!.frame().split("\n").find((line) => line.includes(text)) ?? "";
/** Last occupied column (exclusive) of the line that has `text`. */
const endOf = (text: string): number => lineWith(text).trimEnd().length;

const ListView = List as (props: Parameters<typeof List>[0]) => ReactNode;
const FormView = Fields as (props: Parameters<typeof Fields>[0]) => ReactNode;
const PanelView = Panel as (props: Parameters<typeof Panel>[0]) => ReactNode;
const RowView = Row as (props: Parameters<typeof Row>[0]) => ReactNode;

const COLUMNS = [
  { id: "name", title: "módulo", width: 14 },
  { id: "about", title: "descrição", grow: 1 },
  { id: "state", title: "estado" },
];
const ITEMS = [
  { id: "alfa", cells: { name: "alfa", about: "Lorem ipsum dolor", state: "já instalado" } },
  { id: "beta", cells: { name: "beta", about: "Sit amet", state: "em breve" } },
];

test("a List with a short last column keeps it beside the rest at 250x40, and the highlight spans the table only", async () => {
  h = await renderTui(
    <ThemeProvider><PanelView title="[1] módulos"><ListView items={ITEMS} columns={COLUMNS} selected="alfa" /></PanelView></ThemeProvider>,
    SIZE,
  );
  await h.flush();
  await h.flush();
  expect(endOf("já instalado")).toBeLessThan(CONTENT_MAX_W);
  const row = h.spans().lines.find((line) => line.spans.some((span) => span.text.includes("alfa")))!;
  const selectedFill = row.spans.find((span) => span.text.startsWith("»"))!.bg;
  const highlighted = row.spans.filter((span) => span.bg.equals(selectedFill)).reduce((cells, span) => cells + [...span.text].length, 0);
  expect(highlighted).toBeGreaterThan(0);
  expect(highlighted).toBeLessThan(CONTENT_MAX_W);
});

test("a grow column stops at the readable cap and the rest stays blank at the right", () => {
  const long = COLUMN_MAX_W * 2;
  const widths = columnWidths([{ col: { id: "a", grow: 1 }, natural: long }, { col: { id: "b" }, natural: 8 }], 200);
  expect(widths).toEqual([COLUMN_MAX_W, 8]);
});

test("a grow column never takes more than its content", () => {
  const widths = columnWidths([{ col: { id: "a", grow: 1 }, natural: 10 }, { col: { id: "b" }, natural: 8 }], 200);
  expect(widths).toEqual([10, 8]);
});

test("a Fields form with onDelete keeps [ remover ] with the other buttons at 250x40", async () => {
  h = await renderTui(
    <ThemeProvider><KeyRouter onQuit={() => {}}>
      <FormView fields={[{ id: "ip", label: "IP", kind: "line" }]} onSubmit={() => {}} onCancel={() => {}} onDelete={() => {}} />
    </KeyRouter></ThemeProvider>,
    SIZE,
  );
  await h.flush();
  expect(lineWith("[ salvar ]")).toContain("[ salvar ]  [ cancelar ]  [ remover ]");
  expect(endOf("[ remover ]")).toBeLessThan(CONTENT_MAX_W);
});

test("a Row right aligns to the content width, not to the terminal edge, at 250x40", async () => {
  h = await renderTui(
    <ThemeProvider><RowView right={<Text>[ fim ]</Text>}><Text>começo</Text></RowView></ThemeProvider>,
    SIZE,
  );
  await h.flush();
  const line = lineWith("começo");
  expect(line.indexOf("[ fim ]")).toBeGreaterThan(line.indexOf("começo"));
  expect(endOf("[ fim ]")).toBeLessThanOrEqual(CONTENT_MAX_W);
});

test("a Panel aside aligns to the content width, not to the terminal edge, at 250x40", async () => {
  h = await renderTui(
    <ThemeProvider><PanelView title="[1] rotinas" aside="2 rotinas"><Text>conteúdo</Text></PanelView></ThemeProvider>,
    SIZE,
  );
  await h.flush();
  expect(endOf("2 rotinas")).toBeLessThanOrEqual(CONTENT_MAX_W);
});
