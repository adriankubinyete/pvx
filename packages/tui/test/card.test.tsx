import { afterEach, expect, test } from "bun:test";
import { useState, type ReactNode } from "react";
import { RGBA } from "@opentui/core";
import type { CardSpec } from "@pvx/sdk";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider, tokens } from "../src/index.ts";
import { Card, SdkCardGrid } from "../src/sdk-ui/card.tsx";
import { ConfirmPreview } from "../src/session/ConfirmDialog.tsx";
import { SessionModals } from "../src/session/Modals.tsx";
import { selectedCorners } from "./cards-helpers.ts";

// `Card`, `CardGrid` and `ConfirmPreview` of sdk.ui (UI.md, "Cards" and "Diálogo de confirmação").

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const OneCard = Card as (props: Parameters<typeof Card>[0]) => ReactNode;
const Grid = SdkCardGrid as (props: Parameters<typeof SdkCardGrid>[0]) => ReactNode;
const Preview = ConfirmPreview as (props: Parameters<typeof ConfirmPreview>[0]) => ReactNode;

const INFO: CardSpec = {
  id: "lorem", name: "lorem-ipsum", state: { text: "carregado", tone: "ok" }, line2: { text: "2 comandos · aba Lorem" },
  chips: [{ text: "⚠ só linux", tone: "warn", solid: true }], footnote: "0.1.0",
};
const QUIET: CardSpec = { id: "dolor", name: "dolor-sit", state: { text: "aguardando", tone: "warn" }, line2: { text: "1 comando" }, footnote: "1.0.0" };
const ACTION: CardSpec = { id: "add", name: "adicionar ipsum", action: { key: "a", sub: "lorem ipsum dolor" } };

const shell = (element: ReactNode) => <ThemeProvider><KeyRouter onQuit={() => {}}>{element}</KeyRouter></ThemeProvider>;
const rowsOf = (t: TuiHarness) => t.frame().split("\n");

/** How many cards have their top-left corner (`╭`) drawn in `color`. */
function cornersWith(t: TuiHarness, color: string): number {
  const wanted = RGBA.fromHex(color);
  let count = 0;
  for (const line of t.spans().lines) for (const span of line.spans) if (span.fg.equals(wanted)) count += [...span.text].filter((ch) => ch === "╭").length;
  return count;
}

test("Card: name, state on the right, dim second line, chips and the footnote at the bottom right", async () => {
  h = await renderTui(shell(<OneCard card={INFO} width={40} />), { cols: 60, rows: 8 });
  const rows = rowsOf(h);
  expect(rows[1]).toMatch(/│ +lorem-ipsum +● carregado │/);
  expect(rows[2]).toContain("2 comandos · aba Lorem");
  expect(rows[4]).toMatch(/│ +⚠ só linux +0\.1\.0 │/);
});

test("Card: selected has the accent border, normal the faint one, inactive the muted one with a ›; an action card is dashed with its key", async () => {
  h = await renderTui(shell(<><OneCard card={INFO} state="selected" width={40} /><OneCard card={QUIET} width={40} /><OneCard card={ACTION} width={40} /></>), { cols: 60, rows: 20 });
  expect(selectedCorners(h)).toHaveLength(1); // only the selected one
  expect(cornersWith(h, tokens.border)).toBe(2); // the normal card and the action card
  expect(h.frame()).toMatch(/╭╌+╮/);
  expect(h.frame()).toMatch(/a {2}adicionar ipsum/);
  expect(h.frame()).toContain("lorem ipsum dolor");
  h.destroy();
  h = await renderTui(shell(<OneCard card={INFO} state="inactive" width={40} />), { cols: 60, rows: 8 });
  expect(selectedCorners(h)).toHaveLength(0);
  expect(cornersWith(h, tokens.dim)).toBe(1);
  expect(h.frame()).toContain("│ ›lorem-ipsum");
});

const MANY: CardSpec[] = Array.from({ length: 7 }, (_, index) => ({ id: `m${index + 1}`, name: `m${index + 1}`, line2: { text: `módulo ${index + 1}` } }));

function Harness({ cards, log, focused = true }: { cards: CardSpec[]; log: string[]; focused?: boolean }) {
  const [selected, setSelected] = useState<string>();
  return <Grid cards={cards} selected={selected} onSelect={setSelected} onActivate={(id) => void log.push(id)} focused={focused} />;
}

for (const [cols, perRow] of [[130, 3], [100, 2], [70, 1]] as const) {
  test(`CardGrid at ${cols} columns: ${perRow} per row, inside a page (nothing wider than the screen)`, async () => {
    h = await renderTui(shell(<box flexGrow={1} flexDirection="column" paddingX={1}><Harness cards={MANY} log={[]} /></box>), { cols, rows: 30 });
    expect([...rowsOf(h)[0]!].filter((ch) => ch === "╭")).toHaveLength(perRow);
    for (const row of rowsOf(h)) expect([...row].length).toBeLessThanOrEqual(cols);
  });
}

test("CardGrid: arrows move the selection by id, enter and a click activate, an arrow past the end stays", async () => {
  const log: string[] = [];
  h = await renderTui(shell(<box flexGrow={1} flexDirection="column" paddingX={1}><Harness cards={MANY} log={log} /></box>), { cols: 130, rows: 30 });
  await h.press("ARROW_RIGHT");
  await h.press("ARROW_DOWN");
  await h.press("RETURN");
  expect(log).toEqual(["m5"]);
  for (let i = 0; i < 5; i++) await h.press("ARROW_DOWN");
  await h.press("RETURN");
  expect(log.at(-1)).toBe("m7"); // the short last row
  await h.click(3, 2); // a click on the first card selects and activates it
  expect(log.at(-1)).toBe("m1");
});

test("CardGrid without focus takes no key", async () => {
  const log: string[] = [];
  h = await renderTui(shell(<box flexGrow={1} flexDirection="column" paddingX={1}><Harness cards={MANY} log={log} focused={false} /></box>), { cols: 130, rows: 30 });
  await h.press("ARROW_RIGHT");
  await h.press("RETURN");
  expect(log).toEqual([]);
});

test("ConfirmPreview draws the dialog in place: no backdrop, no key; the real modal still owns the keyboard", async () => {
  let answered: boolean | undefined;
  const pending = [{ id: 1, kind: "confirm" as const, title: "Real?", description: "x", destructive: false }];
  h = await renderTui(shell(
    <box flexGrow={1} flexDirection="column">
      <Preview title="Lorem ipsum dolor?" description={["Lorem ipsum dolor sit amet."]} confirmLabel="remover lorem" cancelLabel="manter" destructive />
      <text>{"depois do preview"}</text>
    </box>,
  ), { cols: 70, rows: 16 });
  const frame = h.frame();
  expect(frame).toContain("Lorem ipsum dolor?");
  expect(frame).toContain("[ remover lorem ]  [ manter ]");
  const dialogRow = rowsOf(h).findIndex((row) => row.includes("Lorem ipsum dolor?"));
  const afterRow = rowsOf(h).findIndex((row) => row.includes("depois do preview"));
  expect(afterRow).toBeGreaterThan(dialogRow); // in the flow of the page, not floating over it
  await h.press("ESCAPE"); // a preview takes no key
  await h.press("RETURN");
  expect(h.frame()).toContain("Lorem ipsum dolor?");
  h.destroy();
  h = await renderTui(shell(<SessionModals store={{ answer: (_id: number, value: unknown) => void (answered = value as boolean) } as never} pending={pending as never} />), { cols: 70, rows: 16 });
  await h.press("ESCAPE");
  expect(answered).toBe(false);
});
