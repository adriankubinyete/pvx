import { afterEach, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadTuiState, tuiStatePath } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, footerFor, glyphs, matchKey, shortcuts, ThemeProvider, useKeys, useRouter, useTheme, type Screen } from "../src/index.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const logs: string[] = [];
const logger = { debug() {}, info() {}, warn() {}, error: (m: string) => void logs.push(m) };

const Boom = () => {
  throw new Error("quebrou no render");
};
function Home() {
  const r = useRouter();
  useKeys((k) => {
    if (k.sequence === "p") return r.push({ id: "filha", element: <text>tela filha</text> }), true;
    if (k.sequence === "b") return r.push({ id: "ruim", element: <Boom /> }), true;
  });
  return <text>tela inicial</text>;
}
const root: Screen = { id: "inicio", element: <Home /> };
const mount = async (cols = 120, rows = 40) => (h = await renderTui(<App root={root} logger={logger} onExit={() => {}} />, { cols, rows }));

test("a screen that throws goes back to the previous one, the session survives and the error is logged", async () => {
  const t = await mount();
  const err = console.error;
  console.error = () => {}; // React reports the caught render error
  await t.press("b");
  console.error = err;
  expect(t.frame()).toContain("tela inicial");
  expect(t.frame()).toContain('tela "ruim" falhou: quebrou no render');
  expect(logs.join("\n")).toContain("quebrou no render");
  await t.press("p"); // keys still work after the crash
  expect(t.frame()).toContain("tela filha");
});

test("esc pops one level; ctrl+c exits through onExit", async () => {
  let exited = 0;
  h = await renderTui(<App root={root} logger={logger} onExit={() => exited++} />);
  await h.press("p");
  expect(h.frame()).toContain("tela filha");
  await h.press("ESCAPE");
  expect(h.frame()).toContain("tela inicial");
  await h.press("c", { ctrl: true });
  expect(exited).toBe(1);
});

test("? help lists every shortcut, owns the keyboard, and covers the footer", async () => {
  const t = await mount();
  await t.press("p");
  const footer = t.frame();
  for (const s of footerFor("session")) expect(footer).toContain(`${s.keys} ${s.label}`);
  await t.press("?");
  const help = t.frame();
  for (const s of shortcuts) expect(help).toContain(s.keys), expect(help).toContain(s.label);
  expect(shortcuts.filter((s) => s.footer).every((s) => help.includes(s.keys))).toBe(true);
  await t.press("ESCAPE"); // closes help only: the modal owned the key, so no pop
  expect(t.frame()).toContain("tela filha");
  expect(t.frame()).not.toContain("esc fecha");
});

test("frame fits 80x24 and 120x40 with chip strip, screen and footer", async () => {
  for (const [cols, rows] of [[80, 24], [120, 40]] as const) {
    const t = await mount(cols, rows);
    const lines = t.frame().split("\n");
    expect(lines[0]).toContain("pvx");
    expect(lines[0]!.trimEnd().length).toBeLessThanOrEqual(cols);
    expect(t.frame()).toContain("tela inicial");
    expect(lines.filter((l) => l.trim()).at(-1)).toContain("ctrl+k palette");
    t.destroy();
  }
});

test("theme axes persist across a reload of tui-state.json", async () => {
  function Probe() {
    const t = useTheme();
    useKeys(() => (t.set({ accent: "azul", symbols: "ascii", border: "single", result: "text" }), true));
    return <text>{`${t.axes.symbols} ${t.result("ok").marker}`}</text>;
  }
  h = await renderTui(<ThemeProvider><KeysHost><Probe /></KeysHost></ThemeProvider>, { cols: 40, rows: 5 });
  await h.press("x");
  expect(h.frame()).toContain("ascii sucesso:");
  h.destroy(); // unmount flushes the debounced write, well before the 300 ms debounce
  await new Promise((r) => setTimeout(r, 20));
  expect(loadTuiState(tuiStatePath())).toMatchObject({ accent: "azul", symbols: "ascii", border: "single", result: "text" });
});

import { KeyRouter } from "../src/index.ts";
function KeysHost({ children }: { children: React.ReactNode }) {
  return <KeyRouter onQuit={() => {}}>{children}</KeyRouter>;
}

test("Shift: matchKey tells l from L by sequence (name stays lowercase)", () => {
  const key = (o: object) => ({ name: "l", sequence: "l", ctrl: false, meta: false, shift: false, ...o }) as never;
  expect(matchKey(key({ name: "l", sequence: "L", shift: true }), "L")).toBe(true);
  expect(matchKey(key({ name: "l", sequence: "L", shift: true }), "l")).toBe(false);
  expect(matchKey(key({ ctrl: true, sequence: "\f" }), "ctrl+l")).toBe(true);
  expect(matchKey(key({ name: "escape", sequence: "\x1b" }), "esc")).toBe(true);
  // A plain terminal sends ctrl+j as a raw \n: name "linefeed", ctrl false.
  expect(matchKey(key({ name: "linefeed", sequence: "\n" }), "ctrl+j")).toBe(true);
});

test("the one shortcut table has a single row per keys + scope and includes the palette's", () => {
  const ids = shortcuts.map((s) => `${s.scope}:${s.keys}`);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain("palette:ctrl+enter");
  expect(ids).toContain("palette:ctrl+j");
});

test("every glyph, unicode and ascii, takes one cell in a rendered frame", async () => {
  const all = new Set(Object.values(glyphs).flatMap((set) => Object.values(set)).flatMap((s) => [...s]));
  for (const g of all) {
    // A 2-cell glyph (like ⚡ or ‼) shortens the padded frame line by one char.
    const t = await renderTui(<box flexDirection="row" width={6} height={1}><text>{g}</text><text>|</text></box>, { cols: 8, rows: 2 });
    expect([...t.frame().split("\n")[0]!].length, `glyph ${g}`).toBe(8);
    t.destroy();
  }
});

test("no hex color literal outside theme.ts", () => {
  const files = readdirSync(join(import.meta.dir, "../src")).filter((f) => /\.tsx?$/.test(f) && f !== "theme.ts");
  const hits = files.filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(join(import.meta.dir, "../src", f), "utf8")));
  expect(hits).toEqual([]);
});
