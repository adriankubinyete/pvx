import { afterEach, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { HostCtx, type HostPage } from "../src/sdk-ui/host.tsx";
import { Fields } from "../src/sdk-ui/fields.tsx";

type Props = Parameters<typeof Fields>[0];
const Form = Fields as (p: Props) => ReactNode; // `Component` returns unknown, which JSX rejects
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const fields = [
  { id: "ip", label: "IP ou CIDR", kind: "line" as const },
  { id: "comment", label: "comentário", kind: "line" as const },
  { id: "deny", label: "bloquear", kind: "toggle" as const, text: "em vez de aceitar" },
];

async function mount(extra: Partial<Props> = {}) {
  const calls = { submit: [] as Record<string, string | boolean>[], cancel: 0, del: 0, keys: [] as string[] };
  const host = { addKey: (s: { keys: string; label: string }) => (calls.keys.push(`${s.keys} ${s.label}`), () => {}) } as unknown as HostPage;
  h = await renderTui(
    <ThemeProvider><KeyRouter onQuit={() => {}}><HostCtx.Provider value={host}>
      <Form fields={fields} onSubmit={(v) => void calls.submit.push(v)} onCancel={() => void calls.cancel++} {...extra} />
    </HostCtx.Provider></KeyRouter></ThemeProvider>,
    { cols: 80, rows: 24 },
  );
  return { t: h, calls };
}
/** 0-based cell of the first match of `text` in the frame. */
const at = (t: TuiHarness, text: string): [number, number] => {
  const rows = t.frame().split("\n");
  const y = rows.findIndex((r) => r.includes(text));
  if (y < 0) throw new Error(`"${text}" not on screen:\n${t.frame()}`);
  return [rows[y]!.indexOf(text), y];
};

test("save and cancel always render; remover only with onDelete", async () => {
  const { t } = await mount();
  expect(t.frame()).toContain("[ salvar ]");
  expect(t.frame()).toContain("[ cancelar ]");
  expect(t.frame()).not.toContain("remover");
  t.destroy();
  const m = await mount({ onDelete: () => {} });
  expect(m.t.frame()).toContain("[ remover ]");
  const m2 = await mount({ onDelete: () => {}, deleteLabel: "excluir" });
  expect(m2.t.frame()).toContain("[ excluir ]");
});

test("down and tab reach the 2nd and 3rd fields, then the buttons, and wrap", async () => {
  const { t, calls } = await mount();
  await t.type("a");
  await t.press("ARROW_DOWN");
  await t.type("b");
  await t.press("TAB");
  await t.press(" ");
  await t.press("TAB"); // salvar
  await t.press("RETURN");
  expect(calls.submit).toEqual([{ ip: "a", comment: "b", deny: true }]);
  await t.press("ARROW_RIGHT"); // cancelar
  await t.press("RETURN");
  expect(calls.cancel).toBe(1);
  await t.press("TAB"); // wraps to the first field
  await t.type("c");
  expect(t.frame()).toContain("ac");
  await t.press("TAB", { shift: true }); // back across the wrap to cancelar
  await t.press(" ");
  expect(calls.cancel).toBe(2);
});

test("enter walks the text fields, toggles a checkbox and submits on the last field", async () => {
  const { t, calls } = await mount({ fields: fields.slice(0, 2) });
  await t.type("x");
  await t.press("RETURN");
  expect(calls.submit).toEqual([]);
  await t.type("y");
  await t.press("RETURN");
  expect(calls.submit).toEqual([{ ip: "x", comment: "y" }]);
  t.destroy();
  const m = await mount();
  await m.t.press("ARROW_UP"); // wraps to the last button
  await m.t.press("ARROW_UP"); // cancelar
  await m.t.press("ARROW_UP"); // the checkbox
  await m.t.press("RETURN");
  expect(m.t.frame()).toContain("[x] em vez de aceitar");
  await m.t.press(" ");
  expect(m.t.frame()).toContain("[ ] em vez de aceitar");
});

test("ctrl+s submits and esc cancels from any field", async () => {
  const { t, calls } = await mount();
  await t.press("ARROW_DOWN");
  await t.press("s", { ctrl: true });
  expect(calls.submit).toHaveLength(1);
  await t.press("ESCAPE");
  expect(calls.cancel).toBe(1);
});

test("onDelete asks for confirmation first; esc backs out, enter confirms", async () => {
  let del = 0;
  const { t, calls } = await mount({ onDelete: () => void del++ });
  await t.press("TAB", { shift: true }); // remover
  await t.press("RETURN");
  expect(t.frame()).toContain("remover? enter confirma · esc volta");
  expect(del).toBe(0);
  await t.press("ESCAPE");
  expect(calls.cancel).toBe(0); // esc only closed the question
  expect(t.frame()).not.toContain("enter confirma");
  await t.press("RETURN");
  await t.press("RETURN");
  expect(del).toBe(1);
});

test("a validation error shows under its field, blocks the submit and focuses the field", async () => {
  const { t, calls } = await mount({ validate: (v) => (String(v.ip) ? undefined : { ip: "IP inválido" }) });
  await t.press("ARROW_DOWN");
  await t.press("s", { ctrl: true });
  expect(calls.submit).toEqual([]);
  const rows = t.frame().split("\n");
  const y = rows.findIndex((r) => r.includes("IP ou CIDR"));
  expect(rows[y + 1]).toContain("IP inválido");
  await t.type("1"); // focus went back to the first field; typing clears its error
  expect(t.frame()).not.toContain("IP inválido");
  await t.press("s", { ctrl: true });
  expect(calls.submit).toHaveLength(1);
});

test("mouse: click focuses a field, toggles a checkbox, presses buttons", async () => {
  let del = 0;
  const { t, calls } = await mount({ onDelete: () => void del++ });
  const [cx, cy] = at(t, "comentário");
  await t.click(cx, cy);
  await t.type("z");
  const [bx, by] = at(t, "[ ] em vez");
  await t.click(bx, by);
  expect(t.frame()).toContain("[x] em vez de aceitar");
  const [sx, sy] = at(t, "[ salvar ]");
  await t.click(sx, sy);
  expect(calls.submit).toEqual([{ ip: "", comment: "z", deny: true }]);
  const [kx, ky] = at(t, "[ cancelar ]");
  await t.click(kx, ky);
  expect(calls.cancel).toBe(1);
  const [rx, ry] = at(t, "[ remover ]");
  await t.click(rx, ry);
  expect(t.frame()).toContain("remover? enter confirma");
  const [qx, qy] = at(t, "remover? enter");
  await t.click(qx, qy);
  expect(del).toBe(1);
});

test("the footer rows for the form are registered", async () => {
  const { calls } = await mount();
  expect(calls.keys).toEqual(expect.arrayContaining(["↑↓ tab campo", "space marca", "ctrl+s salva"]));
});
