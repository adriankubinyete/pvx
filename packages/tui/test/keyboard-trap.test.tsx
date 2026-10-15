import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { ReactNode } from "react";
import { createLogger, createRegistry, logsDir, pvxHome, runCapture, type Registry } from "@pvx/core";
import { expectNoKeyboardTrap, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, ui } from "../src/index.ts";

// A page may render anything, including a form that is always mounted and always focused: the host's keys still leave it (UI.md, section 1).

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

type Loose = (props: Record<string, unknown>) => ReactNode;
const { Fields, Text } = ui as unknown as Record<"Fields" | "Text", Loose>;

const TEXT_FIELDS = [
  { id: "a", label: "Primeiro", kind: "line" },
  { id: "b", label: "Segundo", kind: "line" },
];
const AREA_FIELDS = [{ id: "note", label: "Nota", kind: "area" }];

/** Two page tabs: `Trap` holds an always-mounted `Fields` whose `onCancel` does nothing; `Outra` is plain text. */
function registryWith(fields: unknown[]): Registry {
  const registry = createRegistry();
  const trap = () => <Fields fields={fields} onSubmit={() => {}} onCancel={() => {}} />;
  const other = () => <Text>corpo outra</Text>;
  registry.register({ id: "trap", version: "1.0.0", entry: "x" }, {
    pages: {
      main: { title: "Trap", tab: { label: "Trap", order: 1 }, render: trap },
      other: { title: "Outra", tab: { label: "Outra", order: 2 }, render: other },
    },
  });
  return registry;
}

async function mount(fields: unknown[], { inside = true }: { inside?: boolean } = {}) {
  const registry = registryWith(fields);
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const nav = createTabsNav();
  nav.active = "page:trap.main";
  nav.bar = !inside;
  const root = { id: "menu", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={nav} version="0.1.0" /> };
  h = await renderTui(<App root={root} logger={noopLog} onExit={() => {}} statePath={join(pvxHome(), "s.json")} pages={{ session: store, registry, makeLogger: () => noopLog }} />, { cols: 100, rows: 30 });
  return h;
}
const lastLine = (t: TuiHarness) => t.frame().split("\n").filter((line) => line.trim()).at(-1)!;

for (const [name, fields] of [["text fields", TEXT_FIELDS], ["a textarea", AREA_FIELDS]] as const) {
  test(`${name}: from inside an always-focused form, esc reaches the tab bar and an arrow switches the tab`, async () => {
    const t = await mount(fields);
    expect(t.frame()).toContain(" salvar ");
    await expectNoKeyboardTrap(t);
    await t.press("ARROW_RIGHT");
    expect(t.frame()).toContain("corpo outra");
  });
}

test("the first esc leaves the field (the page keeps the keyboard, the form takes no key), enter goes back in, the second esc reaches the bar", async () => {
  const t = await mount(TEXT_FIELDS);
  await t.type("x");
  expect(t.frame()).toContain("x");
  await t.press("ESCAPE");
  expect(lastLine(t)).toContain("enter edita");
  await t.type("y");
  expect(t.frame()).not.toContain("xy"); // the form does not take the keys now
  await t.press("RETURN");
  expect(lastLine(t)).toContain("tab campo");
  await t.type("z");
  expect(t.frame()).toContain("xz");
  await t.press("ESCAPE");
  await t.press("ESCAPE");
  expect(lastLine(t)).toContain("troca aba");
});

test("tab moves between the fields and buttons; on the last stop it goes to the next tab, on the first shift+tab goes to the previous", async () => {
  const t = await mount(TEXT_FIELDS);
  const stops = TEXT_FIELDS.length + 2; // fields, salvar, cancelar
  for (let i = 0; i < stops - 1; i++) await t.press("TAB");
  expect(t.frame()).not.toContain("corpo outra");
  await t.press("TAB"); // past cancelar: the host's tab
  expect(t.frame()).toContain("corpo outra");
  await t.press("TAB", { shift: true }); // back to Trap, bar focused
  expect(lastLine(t)).toContain("troca aba");
  await t.press("ARROW_DOWN"); // into the page: the focus is where it was, on cancelar
  for (let i = 0; i < stops - 1; i++) await t.press("TAB", { shift: true });
  expect(lastLine(t)).not.toContain("troca aba"); // on the first field
  await t.press("TAB", { shift: true }); // the first stop: the previous tab, not a wrap inside the form
  expect(lastLine(t)).toContain("troca aba");
});

test("with the tab bar focused a mounted form takes no key: tab and the arrows switch the tab", async () => {
  const t = await mount(TEXT_FIELDS, { inside: false });
  expect(lastLine(t)).toContain("troca aba");
  await t.press("TAB");
  expect(t.frame()).toContain("corpo outra");
  await t.press("TAB", { shift: true });
  await t.press("ARROW_RIGHT");
  expect(t.frame()).toContain("corpo outra");
});

test("a form kept mounted behind another tab takes no key", async () => {
  const t = await mount(TEXT_FIELDS);
  await t.press("ESCAPE");
  await t.press("ESCAPE"); // the bar
  await t.press("ARROW_RIGHT"); // Outra
  await t.press("ARROW_DOWN"); // into Outra: the hidden form is still mounted
  await t.press("TAB"); // must switch tab, not move inside the hidden form
  expect(t.frame()).not.toContain("corpo outra");
});
