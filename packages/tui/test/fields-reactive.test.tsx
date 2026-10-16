import { afterEach, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { ReactNode } from "react";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider, tokens } from "../src/index.ts";
import { HostCtx, type HostPage } from "../src/sdk-ui/host.tsx";
import { Fields } from "../src/sdk-ui/fields.tsx";
import { refocus, valueWidth } from "../src/sdk-ui/reactive.ts";

type Props = Parameters<typeof Fields>[0];
type Values = Record<string, string | boolean>;
const Form = Fields as (props: Props) => ReactNode; // `Component` returns unknown, which JSX rejects
const SIZES = [{ cols: 80, rows: 24 }, { cols: 120, rows: 40 }];
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

interface Calls {
  submit: Values[];
  change: Values[];
  extra: Values[];
  keys: string[];
}

async function mount(props: Partial<Props> & Pick<Props, "fields">, size = SIZES[0]!) {
  const calls: Calls = { submit: [], change: [], extra: [], keys: [] };
  const host = { addKey: (spec: { keys: string; label: string }) => (calls.keys.push(`${spec.keys} ${spec.label}`), () => {}) } as unknown as HostPage;
  h = await renderTui(
    <ThemeProvider><KeyRouter onQuit={() => {}}><HostCtx.Provider value={host}>
      <Form onSubmit={(values) => void calls.submit.push(values)} onChange={(values) => void calls.change.push(values)} onCancel={() => {}} {...props} />
    </HostCtx.Provider></KeyRouter></ThemeProvider>,
    size,
  );
  return { t: h, calls };
}
/** 0-based column of the first match of `text` in the frame. */
const columnOf = (t: TuiHarness, text: string): number => {
  const row = t.frame().split("\n").find((line) => line.includes(text));
  if (!row) throw new Error(`"${text}" not on screen:\n${t.frame()}`);
  return row.indexOf(text);
};

const SCHEDULE = [
  { id: "mode", label: "Quando", kind: "choice" as const, style: "buttons" as const, options: [{ value: "daily", label: "todo dia" }, { value: "weekly", label: "toda semana" }] },
  { id: "day", label: "Dia", kind: "line" as const, required: true, when: (values: Values) => values.mode === "weekly" },
  { id: "path", label: "Pasta", kind: "line" as const },
];

for (const size of SIZES) {
  test(`${size.cols}x${size.rows}: a field with \`when\` shows and hides with the values, and the focus skips it while hidden`, async () => {
    const { t } = await mount({ fields: SCHEDULE }, size);
    expect(t.frame()).not.toContain("Dia");
    await t.press("ARROW_DOWN"); // mode -> path: the hidden field is skipped
    await t.type("x");
    expect(t.frame()).toMatch(/Pasta\s+x/);
    await t.press("ARROW_UP");
    await t.press("ARROW_RIGHT"); // weekly: `Dia` shows, under the choice
    expect(t.frame()).toContain("Dia");
    await t.press("ARROW_DOWN");
    await t.type("seg");
    expect(t.frame()).toMatch(/Dia \*\s+seg/);
    await t.press("ARROW_DOWN");
    await t.type("y");
    expect(t.frame()).toMatch(/Pasta\s+xy/);
  });

  test(`${size.cols}x${size.rows}: a hidden field is not submitted, not required and not validated; a shown one is`, async () => {
    const { t, calls } = await mount({ fields: SCHEDULE, validate: (values) => (values.day === "bad" ? { day: "dia inválido" } : undefined) }, size);
    await t.press("ARROW_RIGHT"); // weekly
    await t.press("ARROW_DOWN");
    await t.type("bad");
    await t.press("ARROW_UP");
    await t.press("ARROW_LEFT"); // back to daily: `day` is hidden with its bad value
    await t.press("s", { ctrl: true });
    expect(calls.submit).toEqual([{ mode: "daily", path: "" }]);
    await t.press("ARROW_RIGHT"); // weekly again: `day` holds "bad" and is checked now
    await t.press("s", { ctrl: true });
    expect(calls.submit).toHaveLength(1);
    expect(t.frame()).toContain("✗ dia inválido");
  });

  test(`${size.cols}x${size.rows}: a required hidden field does not block the submit`, async () => {
    const { t, calls } = await mount({ fields: SCHEDULE }, size);
    await t.press("s", { ctrl: true });
    expect(calls.submit).toEqual([{ mode: "daily", path: "" }]);
    expect(t.frame()).not.toContain("preencha este campo");
  });

  test(`${size.cols}x${size.rows}: the labels keep their column when a field with a longer label comes and goes`, async () => {
    const fields = [
      { id: "mode", label: "Quando", kind: "choice" as const, style: "buttons" as const, options: [{ value: "a", label: "a" }, { value: "b", label: "b" }] },
      { id: "long", label: "Pasta de destino", kind: "line" as const, when: (values: Values) => values.mode === "b" },
      { id: "path", label: "Nome", kind: "line" as const },
    ];
    const { t } = await mount({ fields }, size);
    const before = columnOf(t, "[ salvar ]");
    const nameColumn = columnOf(t, "Nome");
    await t.press("ARROW_RIGHT");
    expect(t.frame()).toContain("Pasta de destino");
    expect(columnOf(t, "Nome")).toBe(nameColumn);
    expect(columnOf(t, "[ salvar ]")).toBe(before);
  });

  test(`${size.cols}x${size.rows}: onChange hears each change once, with the shown values, and not the first draw`, async () => {
    const { t, calls } = await mount({ fields: SCHEDULE }, size);
    expect(calls.change).toEqual([]);
    await t.press("ARROW_RIGHT");
    expect(calls.change).toEqual([{ mode: "weekly", day: "", path: "" }]);
    await t.press("ARROW_DOWN");
    await t.type("s");
    expect(calls.change.at(-1)).toEqual({ mode: "weekly", day: "s", path: "" });
    await t.press("ARROW_UP");
    await t.press("ARROW_LEFT");
    expect(calls.change.at(-1)).toEqual({ mode: "daily", path: "" });
    expect(calls.change).toHaveLength(3);
  });

  test(`${size.cols}x${size.rows}: the chosen option of a buttons or radio choice shows its detail under the row`, async () => {
    const options = [{ value: "a", label: "diário", detail: "roda todo dia" }, { value: "b", label: "semanal", detail: "roda aos domingos" }, { value: "c", label: "livre" }];
    for (const style of ["buttons", "radio"] as const) {
      const { t } = await mount({ fields: [{ id: "mode", label: "Quando", kind: "choice", style, options }, { id: "path", label: "Pasta", kind: "line" }] }, size);
      expect(t.frame()).toContain("roda todo dia");
      expect(t.frame()).not.toContain("roda aos domingos");
      const row = t.frame().split("\n").findIndex((line) => line.includes("Quando"));
      expect(t.frame().split("\n")[row + 1]).toContain("roda todo dia");
      expect(columnOf(t, "roda todo dia")).toBe(columnOf(t, "diário") - (style === "buttons" ? 1 : 4)); // under the options
      await t.press("ARROW_RIGHT");
      expect(t.frame()).toContain("roda aos domingos");
      expect(t.frame()).not.toContain("roda todo dia");
      await t.press("ARROW_RIGHT"); // an option with no detail: no line, no blank row left over
      expect(t.frame()).not.toContain("roda");
      t.destroy();
    }
  });

  test(`${size.cols}x${size.rows}: the summary line is always on screen above the buttons and follows the values`, async () => {
    const { t } = await mount({ fields: SCHEDULE, summary: (values) => (values.mode === "weekly" ? "toda semana, domingo" : "todo dia às 03:30") }, size);
    const lines = () => t.frame().split("\n");
    const summaryRow = () => lines().findIndex((line) => line.includes("todo dia às 03:30"));
    expect(summaryRow()).toBeGreaterThan(0);
    const buttons = lines().findIndex((line) => line.includes("[ salvar ]"));
    expect(buttons - summaryRow()).toBe(2); // one blank row between the summary and the buttons
    await t.press("ARROW_RIGHT");
    expect(t.frame()).toContain("toda semana, domingo");
    expect(t.frame()).not.toContain("todo dia às 03:30");
  });

  test(`${size.cols}x${size.rows}: an empty summary draws nothing`, async () => {
    const { t } = await mount({ fields: SCHEDULE, summary: () => "" }, size);
    const buttons = t.frame().split("\n").findIndex((line) => line.includes("[ salvar ]"));
    const lines = t.frame().split("\n");
    expect(lines[buttons - 1]!.trim()).toBe(""); // the one blank row before the buttons
    expect(lines[buttons - 2]).toContain("Pasta"); // and the last field right above it: no summary row
    expect(t.frame()).not.toContain("undefined");
  });

  test(`${size.cols}x${size.rows}: extra actions sit after the primary button, validate like it and take the busy state`, async () => {
    let finish: () => void = () => {};
    const extras = [{ label: "salvar e rodar agora", onPress: (values: Values) => (calls.extra.push(values), new Promise<void>((resolve) => (finish = resolve))) }];
    const fields = [{ id: "name", label: "Nome", kind: "line" as const, required: true }];
    const { t, calls } = await mount({ fields, extraActions: extras }, size);
    expect(t.frame()).toContain("[ salvar ]  [ salvar e rodar agora ]  [ cancelar ]");
    await t.press("ARROW_DOWN"); // salvar
    await t.press("ARROW_RIGHT"); // salvar e rodar agora
    await t.press("RETURN");
    expect(calls.extra).toEqual([]); // required and empty: blocked like the primary
    expect(t.frame()).toContain("preencha este campo");
    await t.type("rotina");
    await t.press("TAB"); // salvar
    await t.press("TAB"); // the extra action
    await t.press("RETURN");
    expect(calls.extra).toEqual([{ name: "rotina" }]);
    expect(calls.submit).toEqual([]); // not the primary
    expect(t.frame()).toMatch(/\[ \S+ executando… \]/); // the pressed button shows the spinner
    expect(t.frame()).not.toContain("[ salvar e rodar agora ]");
    expect(t.frame()).toContain("[ salvar ]"); // the others stay, dim
    await t.press("RETURN"); // busy: nothing runs again
    expect(calls.extra).toHaveLength(1);
    finish();
    await Bun.sleep(20);
    await t.flush();
    expect(t.frame()).toContain("[ salvar e rodar agora ]");
  });

  test(`${size.cols}x${size.rows}: an extra action's keys work from a text field and show in the footer; only the focused button is filled`, async () => {
    const extras = [{ label: "salvar e rodar", keys: "ctrl+r", onPress: (values: Values) => void calls.extra.push(values) }];
    const { t, calls } = await mount({ fields: [{ id: "name", label: "Nome", kind: "line" }], extraActions: extras }, size);
    await t.type("a");
    await t.press("r", { ctrl: true });
    expect(calls.extra).toEqual([{ name: "a" }]);
    expect(calls.keys).toContain("ctrl+r salvar e rodar");
  });
}

test("extra actions follow the focused-only fill: one button filled at a time", async () => {
  const extras = [{ label: "salvar e rodar", onPress: () => {} }];
  const { t } = await mount({ fields: [{ id: "name", label: "Nome", kind: "line" }], extraActions: extras });
  const filled = (label: string) => t.spans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(label))!.bg.equals(RGBA.fromHex(tokens.accent));
  expect([filled("[ salvar ]"), filled("[ salvar e rodar ]"), filled("[ cancelar ]")]).toEqual([false, false, false]);
  await t.press("TAB");
  expect([filled("[ salvar ]"), filled("[ salvar e rodar ]"), filled("[ cancelar ]")]).toEqual([true, false, false]);
  await t.press("TAB");
  expect([filled("[ salvar ]"), filled("[ salvar e rodar ]"), filled("[ cancelar ]")]).toEqual([false, true, false]);
  await t.press("TAB");
  expect([filled("[ salvar ]"), filled("[ salvar e rodar ]"), filled("[ cancelar ]")]).toEqual([false, false, true]);
});

test("the value cell grows with the form: normal 40%, long 60%, short 20, at least 30 for the first two", () => {
  expect(valueWidth(undefined, 78, 69)).toBe(31);
  expect(valueWidth("normal", 118, 109)).toBe(47);
  expect(valueWidth("long", 78, 69)).toBe(46);
  expect(valueWidth("long", 118, 109)).toBe(70);
  expect(valueWidth("short", 118, 109)).toBe(20);
  expect(valueWidth("normal", 60, 51)).toBe(30);
  expect(valueWidth("long", 118, 40)).toBe(40); // never past the room the label leaves
  expect(valueWidth("normal", 30, 5)).toBe(12);
});

test("refocus keeps the focus on the same field when others come or go, and buttons stay buttons", () => {
  expect(refocus(["a", "b"], ["a", "x", "b"], 1)).toBe(2);
  expect(refocus(["a", "x", "b"], ["a", "b"], 2)).toBe(1);
  expect(refocus(["a", "x", "b"], ["a", "b"], 1)).toBe(1); // the focused field went away: its place
  expect(refocus(["a", "x"], ["a"], 1)).toBe(0);
  expect(refocus(["a", "b"], ["a", "x", "b"], 2)).toBe(3); // the first button
  expect(refocus(["a", "x", "b"], ["a", "b"], 4)).toBe(3);
});

for (const size of SIZES) {
  test(`${size.cols}x${size.rows}: the value cell is wider on a wider terminal, and \`width\` picks short, normal or long`, async () => {
    const fields = ["short", "normal", "long"].map((width) => ({ id: width, label: "Pasta", kind: "line" as const, width: width as "short" | "normal" | "long", help: `dica-${width}` }));
    const { t } = await mount({ fields }, size);
    const cell = (width: string) => columnOf(t, `dica-${width}`) - 2 - (2 + "Pasta".length + 2);
    const formW = size.cols - 2;
    expect(cell("short")).toBe(20);
    expect(cell("normal")).toBe(valueWidth("normal", formW, formW - 9));
    expect(cell("long")).toBe(valueWidth("long", formW, formW - 9));
    expect(cell("normal")).toBeGreaterThanOrEqual(30);
    expect(cell("long")).toBeGreaterThan(cell("normal"));
  });

  test(`${size.cols}x${size.rows}: a long value shows its start with … while unfocused and scrolls only while editing`, async () => {
    const path = "/var/backups/clientes/12-3-acme/producao/diario/2026-10-16/dump-completo-do-banco.tar.gz";
    const fields = [{ id: "dest", label: "Pasta", kind: "line" as const, width: "long" as const }, { id: "other", label: "Outra", kind: "line" as const }];
    const { t } = await mount({ fields, initial: { dest: path } }, size);
    expect(t.frame()).toContain("tar.gz"); // focused: the cursor is at the end, the tail shows
    expect(t.frame()).not.toContain("/var/backups");
    await t.press("ARROW_DOWN");
    const row = t.frame().split("\n").find((line) => line.includes("Pasta"))!;
    expect(row).toContain("/var/backups/clientes");
    expect(row).not.toContain("tar.gz");
    expect(row).toMatch(/…/);
    expect(row.indexOf("…")).toBe(columnOf(t, "/var/backups") + valueWidth("long", size.cols - 2, size.cols - 2 - 9) - 1);
  });
}
