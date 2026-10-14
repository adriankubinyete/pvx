import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { createRegistry, type ModuleRow } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { CardGrid } from "../src/menu/CardGrid.tsx";
import { actionCards, cardActions, catalogCards, gridCols, moduleCards, repoOf, type Card } from "../src/menu/cards.ts";
import { buildRoot } from "../src/menu/tree.ts";
import { RGBA } from "@opentui/core";
import { tokens } from "../src/theme.ts";
import { selectedCorners, selectedName, subtleCorners } from "./cards-helpers.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const noHidden = new Set<string>();
/** A registry with `fw` (external: tab, widget, incompatible) and `ofc` (official, nothing else). */
function fixture(hiddenTabs = noHidden, hiddenWidgets = noHidden) {
  const registry = createRegistry();
  registry.register({ id: "fw", version: "0.1.0", entry: "x" }, {
    commands: { allow: { help: "a", run() {} }, deny: { help: "d", run() {} } },
    pages: { main: { title: "Firewall", tab: true, render: () => null } },
    widgets: { w: { slot: "home.chips", priority: 1, data: () => [] } },
  });
  registry.register({ id: "ofc", version: "1.0.0", entry: "x" }, { commands: { hi: { help: "h", run() {} } } });
  registry.official.add("ofc");
  const rows: ModuleRow[] = [
    { id: "fw", state: "carregado", version: "0.1.0", url: "https://github.com/acme/pvx-firewall.git", ref: "main", sha: "b02db61abcdef", always: true, incompatible: "feito para linux; este sistema é Windows" },
    { id: "ofc", state: "carregado", version: "1.0.0", official: true },
  ];
  return moduleCards(buildRoot(registry, rows), registry, rows, hiddenTabs, hiddenWidgets);
}

test("a module card says what it is, what it delivers and what needs attention", () => {
  const [fw, ofc] = fixture();
  expect(fw).toMatchObject({ name: "fw", origin: "usermodule", version: "0.1.0", state: { text: "carregado", tone: "ok" }, line2: { text: "2 comandos · aba Firewall" } });
  expect(fw!.chips.map((c) => c.text)).toEqual(["⚠ só linux"]);
  expect(fw!.chips[0]).toMatchObject({ tone: "warn", solid: true });
  expect(fw!.detail.parts.map((p) => p.text).join("")).toBe("fw · acme/pvx-firewall @ main · b02db61 · em dia");
  expect(fw!.detail.warn).toEqual({ text: "⚠ feito para linux; este sistema é Windows", tone: "warn" });
  expect(ofc).toMatchObject({ origin: "official", official: true, version: "1.0.0", chips: [], line2: { text: "1 comando" } });
});

test("a hidden tab or widget shows as a dim chip", () => {
  const [fw] = fixture(new Set(["fw"]), new Set(["fw"]));
  expect(fw!.chips.map((c) => [c.text, c.tone])).toContainEqual(["aba oculta", "dim"]);
  expect(fw!.chips.map((c) => [c.text, c.tone])).toContainEqual(["widget oculto", "dim"]);
});

test("the action menu lists only what applies to the card", () => {
  const [fw, ofc] = fixture();
  expect(cardActions(fw!).map((a) => [a.label, a.key])).toEqual([
    ["abrir a aba Firewall", undefined], ["comandos e páginas", "l"], ["mostrar a aba", "t"], ["widgets no Início", "w"], ["atualizar", "u"], ["desativar", "d"], ["remover", "x"],
  ]);
  expect(cardActions(fw!).filter((a) => a.state).map((a) => a.state)).toEqual(["✓", "✓"]);
  expect(cardActions(fixture(new Set(["fw"]))[0]!).map((a) => a.label)).not.toContain("abrir a aba Firewall"); // a hidden tab cannot be opened
  expect(cardActions(fixture(new Set(["fw"]))[0]!).find((a) => a.id === "tab")!.state).toBe("—");
  expect(cardActions(ofc!).map((a) => a.label)).toEqual(["comandos e páginas"]); // official: nothing to update, disable or remove
  const [cat] = catalogCards([{ id: "gm", url: "https://github.com/acme/gm", descricao: "x" }]);
  expect(cardActions(cat!).map((a) => a.label)).toEqual(["instalar"]);
});

test("the grid has 3 columns from 120 terminal columns, 2 from 80, else 1", () => {
  expect([130, 120, 100, 80, 79, 70].map(gridCols)).toEqual([3, 3, 2, 2, 1, 1]);
  expect(repoOf("https://github.com/acme/pvx-firewall.git")).toBe("acme/pvx-firewall");
  expect(repoOf("git@github.com:acme/x.git")).toBe("acme/x");
});

const many = (n: number): Card[] => catalogCards(Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, url: `https://github.com/acme/m${i + 1}`, descricao: `módulo ${i + 1}` })));

function Grid({ cards, activated, focused = true }: { cards: Card[]; activated: string[]; focused?: boolean }) {
  const [sel, setSel] = useState<string>();
  return <CardGrid cards={cards} sel={sel} onSel={setSel} onActivate={(c) => activated.push(c.id)} focused={focused} />;
}
async function render(cards: Card[], cols: number, activated: string[] = [], focused = true) {
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><box flexGrow={1} flexDirection="column"><Grid cards={cards} activated={activated} focused={focused} /></box></KeyRouter></ThemeProvider>, { cols, rows: 30 });
  return h;
}

for (const [cols, n] of [[130, 3], [100, 2], [70, 1]] as const) {
  test(`${cols} columns: ${n} card${n > 1 ? "s" : ""} per row, the selected one with the accent border`, async () => {
    const t = await render(many(7), cols);
    const top = t.frame().split("\n")[0]!;
    expect([...top].filter((ch) => ch === "╭").length).toBe(n);
    expect(selectedCorners(t)).toHaveLength(1);
    expect(selectedName(t)).toBe("m1");
    for (const l of t.frame().split("\n")) expect([...l].length).toBeLessThanOrEqual(cols);
  });
}

test("arrows move the selection by card and by row; a short last row is reachable", async () => {
  const t = await render(many(7), 130);
  await t.press("ARROW_RIGHT");
  expect(selectedName(t)).toBe("m2");
  await t.press("ARROW_DOWN");
  expect(selectedName(t)).toBe("m5");
  await t.press("ARROW_LEFT");
  expect(selectedName(t)).toBe("m4");
  await t.press("ARROW_UP");
  expect(selectedName(t)).toBe("m1");
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  expect(selectedName(t)).toBe("m7"); // m4 + 3 does not exist: the last card
  await t.press("ARROW_RIGHT");
  expect(selectedName(t)).toBe("m7"); // the end stays
});

test("dashed cards show their key, label and sub line, and enter activates the selected card", async () => {
  const activated: string[] = [];
  const t = await render([...many(1), ...actionCards(4)], 100, activated);
  const f = t.frame();
  expect(f).toMatch(/a {2}adicionar por URL/);
  expect(f).toContain("usuario/repo ou link git");
  expect(f).toMatch(/c {2}abrir o catálogo/);
  expect(f).toContain("4 módulos disponíveis");
  expect(f).toContain("╌"); // dashed border
  await t.press("ARROW_RIGHT");
  await t.press("RETURN");
  await t.press("ARROW_RIGHT");
  await t.press("RETURN");
  expect(activated).toEqual(["act:add", "act:catalog"]);
  expect(actionCards(undefined)[1]!.sub).toBe("catálogo indisponível");
});

test("without focus the selected card keeps a muted border (dim, no accent); with focus it is the accent one", async () => {
  const t = await render(many(4), 100, [], false);
  expect(selectedCorners(t)).toHaveLength(0);
  expect(subtleCorners(t)).toEqual([{ x: 0, y: 0 }]);
  t.destroy();
  const f = await render(many(4), 100);
  expect(selectedCorners(f)).toHaveLength(1);
  expect(subtleCorners(f)).toHaveLength(0);
});

test("bottom line: oficial or the attention chips on the left, the version always on the right", async () => {
  const t = await render(fixture(), 100);
  const line = t.frame().split("\n").find((l) => l.includes("⚠ só linux"))!;
  expect(line).toMatch(/│ +⚠ só linux +0\.1\.0 │/);
  expect(line).toMatch(/│ oficial +1\.0\.0 │/);
  expect(t.frame()).not.toContain("∞");
});

/** Per card of the row: whether `›` stands before the name, and whether the name is underlined. */
function nameStyle(t: TuiHarness, y: number) {
  const marked: boolean[] = [];
  const underlined: boolean[] = [];
  for (const s of t.spans().lines[y]!.spans) {
    const m = /^([› ]?)m\d$/.exec(s.text);
    if (!m) continue;
    marked.push(m[1] === "›");
    underlined.push((s.attributes & 8) !== 0);
  }
  return { marked, underlined };
}

/** Whether the cell has the hover tint (the panel color) as background. */
function cellBg(t: TuiHarness, x: number, y: number): boolean {
  let at = 0;
  for (const s of t.spans().lines[y]!.spans) {
    if (x < at + s.width) return s.bg.equals(RGBA.fromHex(tokens.panel));
    at += s.width;
  }
  return false;
}

const second = { x: 48 + 1 + 4, y: 1 }; // inside the second card at 100 columns (width 48, gap 1)

test("without focus hovering a card changes nothing; a click selects it and activates it; with focus hover moves the selection", async () => {
  const activated: string[] = [];
  const t = await render(many(4), 100, activated, false);
  await t.hover(second.x, second.y);
  expect(subtleCorners(t)).toEqual([{ x: 0, y: 0 }]); // same card, still muted
  expect(cellBg(t, 49, 1)).toBe(true); // ...but the hovered card has the tint
  expect(nameStyle(t, 1)).toMatchObject({ marked: [true, false], underlined: [false, true] }); // and its name is underlined; the selected one keeps `›`
  await t.hover(80, 20); // off the cards
  expect(cellBg(t, 49, 1)).toBe(false);
  expect(nameStyle(t, 1)).toMatchObject({ marked: [true, false], underlined: [false, false] });
  await t.hover(second.x, second.y);
  await t.click(second.x, second.y);
  expect(activated).toEqual(["k:m2"]);
  expect(subtleCorners(t)).toEqual([{ x: 49, y: 0 }]); // the selection moved on click
  t.destroy();
  const f = await render(many(4), 100);
  await f.hover(second.x, second.y);
  expect(selectedName(f)).toBe("m2");
});

for (const cols of [96, 130]) {
  test(`${cols} columns: 4 modules and the 2 dashed cards are all drawn`, async () => {
    const t = await render([...many(4), ...actionCards(4)], cols);
    const f = t.frame();
    const per = gridCols(cols);
    for (const name of ["m1", "m2", "m3", "m4"]) expect(f).toContain(name);
    expect(f).toMatch(/a {2}adicionar por URL/);
    expect(f).toMatch(/c {2}abrir o catálogo/);
    expect([...f.split("\n").filter((l) => l.includes("╭")).join("")].filter((ch) => ch === "╭")).toHaveLength(6);
    expect(f.split("\n").filter((l) => /^ ?╭/.test(l))).toHaveLength(Math.ceil(6 / per));
  });
}

test("every card fits inside the frame: the right border is drawn within the columns, at any width", async () => {
  for (const cols of [70, 80, 96, 100, 119, 120, 140]) {
    const t = await render(many(7), cols);
    const top = t.frame().split("\n")[0]!;
    const n = gridCols(cols);
    const rights = [...top].flatMap((ch, i) => (ch === "╮" ? [i] : []));
    expect(rights).toHaveLength(n);
    expect(rights.at(-1)!).toBeLessThan(cols - 1); // the frame keeps its padding column
    for (const l of t.frame().split("\n").slice(0, 6)) expect(l).not.toContain("…");
    t.destroy();
  }
});
