// The primitives of the stage-1 kit, pinned in frames at 80x24 and 120x40: notice tones and action, Badge, Details, Meter, Spark,
// radio / buttons / multi row, CopyBlock, List alignment, filter chips, Button states, Scroll, the top bar and the scrollback.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { ReactNode } from "react";
import { RGBA } from "@opentui/core";
import type { DetailItem } from "@pvx/sdk";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, type Registry } from "@pvx/core";
import { renderPage, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, KeyRouter, Session, Tabs, ThemeProvider, tokens as base } from "../src/index.ts";
import { applyAccent, glyphs, hexTokensFor, THEME_NAMES, tokensFor } from "../src/theme.ts";
import { NudgeProvider } from "../src/nudge.tsx";
import { HostCtx, type HostPage } from "../src/sdk-ui/host.tsx";
import { CopyBlock, CopyProvider } from "../src/sdk-ui/copy.tsx";
import { barVersion } from "../src/tabs/bar.ts";
import { copyText, detailColumnCount, detailColumns, meterBar, meterTone, percentText, sparkText } from "../src/sdk-ui/display.ts";
import { buttonLook } from "../src/sdk-ui/button.tsx";

const MODULE = join(import.meta.dir, "../../core/test/fixtures/jobmodules/primitives-demo");
const SIZES = [[80, 24], [120, 40]] as const;
const tokens = applyAccent("dark", base, "tema");
const color = (hex: string) => RGBA.fromHex(hex);
const PAGE_DOWN = "\x1b[6~"; // the harness has no name for it

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const rowsOf = (t: TuiHarness) => t.frame().split("\n");
const rowIndex = (t: TuiHarness, text: string) => rowsOf(t).findIndex((row) => row.includes(text));
const columnOf = (t: TuiHarness, text: string) => rowsOf(t)[rowIndex(t, text)]!.indexOf(text);
/** The first span of the frame that holds `text`. */
function spanOf(t: TuiHarness, text: string) {
  for (const line of t.spans().lines) {
    const span = line.spans.find((candidate) => candidate.text.includes(text));
    if (span) return span;
  }
  throw new Error(`"${text}" has no span`);
}
const fits = (t: TuiHarness, cols: number) => expect(rowsOf(t).every((row) => [...row].length <= cols)).toBe(true);

// ---- the info token ----

test("every theme has the blue info token (and the ip token), also the terminal theme", () => {
  for (const name of THEME_NAMES) {
    const set = tokensFor(name);
    expect(set.info, name).toBeDefined();
    expect(set.ip, name).toBeDefined();
  }
  expect(hexTokensFor("dark")!.info).toBe("#7cc4ff");
  expect(hexTokensFor("light")!.info).toBe("#0b5394");
  expect(hexTokensFor("contrast")!.info).toBe("#6cc9ff");
  expect(String(tokensFor("terminal").info)).not.toBe(String(tokensFor("terminal").accent)); // blue, not the green accent
});

// ---- Notice: four tones and an inline button ----

for (const [cols, rows] of SIZES) {
  test(`Notice: [✓] success, [!] warn, [✗] error, [i] blue; the button sits at the end of the line and acts (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "notices", { cols, rows });
    for (const marker of ["[✓]", "[!]", "[✗]", "[i]"]) expect(h.frame()).toContain(marker);
    expect(spanOf(h, "[✓]").fg.equals(color(tokens.ok))).toBe(true);
    expect(spanOf(h, "[!]").fg.equals(color(tokens.warn))).toBe(true);
    expect(spanOf(h, "[✗]").fg.equals(color(tokens.error))).toBe(true);
    expect(spanOf(h, "[i]").fg.equals(color(tokens.info))).toBe(true);
    const warnRow = rowsOf(h)[rowIndex(h, "[!]")]!;
    expect(warnRow.indexOf("[ resolver ]")).toBeGreaterThan(warnRow.indexOf("lorem ipsum dolor") + "lorem ipsum dolor".length);
    expect(warnRow.trimEnd().endsWith("[ resolver ]")).toBe(true);
    await h.click(columnOf(h, "[ resolver ]") + 3, rowIndex(h, "[ resolver ]"));
    expect(h.frame()).toContain("resolvido");
    fits(h, cols);
  });
}

// ---- Badge ----

for (const [cols, rows] of SIZES) {
  test(`Badge: a solid chip of bold uppercase text in ok, warn, error and info (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "badges", { cols, rows });
    const expected: [string, string][] = [[" ATIVO ", tokens.accent], [" DESATUALIZADO ", tokens.warn], [" PARADO ", tokens.error], [" NOVO ", tokens.info]];
    for (const [text, bg] of expected) {
      expect(h.frame()).toContain(text);
      const span = spanOf(h, text);
      expect(span.bg.equals(color(bg)), text).toBe(true);
      expect(span.fg.equals(color(tokens.bg)), text).toBe(true);
    }
    fits(h, cols);
  });
}

// ---- Details ----

const items: DetailItem[] = [
  { label: "motor", value: "nftables", note: "(automático)" },
  { label: "regras", value: "39 de 40" },
  { label: "último apply", value: "ontem" },
];

test("Details layout: items alternate between two columns, each with its own label width; one column below 100 columns", () => {
  expect(detailColumnCount(2, 120)).toBe(2);
  expect(detailColumnCount(2, 99)).toBe(1);
  expect(detailColumnCount(1, 200)).toBe(1);
  const [left, right] = detailColumns(items, 2);
  expect(left!.items.map((item) => item.label)).toEqual(["motor", "último apply"]);
  expect(right!.items.map((item) => item.label)).toEqual(["regras"]);
  expect(left!.labelWidth).toBe("último apply".length);
  expect(left!.valueWidth).toBe("nftables (automático)".length);
});

test("Details: two columns at 120x40 (label dim, aligned, value in its tone), one column at 80x24", async () => {
  h = await renderPage(MODULE, "details", { cols: 120, rows: 40 });
  const first = rowsOf(h)[rowIndex(h, "motor")]!;
  expect(first).toContain("regras"); // the second item shares the row
  expect(first).toMatch(/motor {2,}nftables \(automático\)\s+regras {2}39 de 40 carregadas/);
  expect(columnOf(h, "último apply") - 0).toBe(columnOf(h, "motor")); // the labels of the left column line up
  expect(columnOf(h, "nftables")).toBe(columnOf(h, "ontem 03:31")); // and so do the values
  expect(spanOf(h, "motor").fg.equals(color(tokens.dim))).toBe(true);
  expect(spanOf(h, "ontem 03:31").fg.equals(color(tokens.warn))).toBe(true);
  expect(spanOf(h, "10.0.0.1").fg.equals(color(tokens.ip))).toBe(true);
  h.destroy();
  h = await renderPage(MODULE, "details", { cols: 80, rows: 24 });
  expect(rowsOf(h)[rowIndex(h, "motor")]).not.toContain("regras"); // one column: every item on its own row
  expect(rowIndex(h, "regras")).toBe(rowIndex(h, "motor") + 1);
  expect(columnOf(h, "nftables")).toBe(columnOf(h, "39 de 40")); // values aligned in the one column
  fits(h, 80);
});

// ---- Meter and Spark ----

test("Meter and Spark are pure: the bar, the threshold and the series", () => {
  const unicode = glyphs.unicode;
  expect(meterBar(0.41, 20, unicode)).toEqual({ filled: "━".repeat(8), empty: "─".repeat(12) });
  expect(meterBar(2, 4, unicode)).toEqual({ filled: "━━━━", empty: "" });
  expect(meterBar(-1, 4, unicode)).toEqual({ filled: "", empty: "────" });
  expect(meterTone(0.8)).toBe("accent"); // above the threshold, not at it
  expect(meterTone(0.81)).toBe("warn");
  expect(meterTone(0.5, 0.4)).toBe("warn");
  expect(percentText(0.4)).toBe(" 40%");
  expect(percentText(1)).toBe("100%");
  const series = sparkText([0, 50, 100], 3, 100, unicode);
  expect([...series]).toHaveLength(3);
  expect(series.startsWith("▁")).toBe(true);
  expect(series.endsWith("█")).toBe(true);
});

for (const [cols, rows] of SIZES) {
  test(`Meter: the thin bar with percentage and suffix, accent below 80% and warn above; Spark in blocks (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "gauges", { cols, rows });
    expect(h.frame()).toContain(`disco    ${"━".repeat(8)}${"─".repeat(12)}   41%  18 de 44 GB`);
    expect(rowsOf(h)[rowIndex(h, "memória")]).toContain(`${"━".repeat(17)}${"─".repeat(3)}   86%`);
    expect(spanOf(h, "━".repeat(8)).fg.equals(color(tokens.accent))).toBe(true);
    expect(spanOf(h, "━".repeat(17)).fg.equals(color(tokens.warn))).toBe(true);
    const exactRow = rowIndex(h, "exato");
    const exactSpan = h.spans().lines[exactRow]!.spans.find((span) => span.text.includes("━"))!;
    expect(exactSpan.fg.equals(color(tokens.accent))).toBe(true); // exactly 80%: not above
    const sparkRow = rowsOf(h)[rowIndex(h, "cpu")]!;
    expect(sparkRow).toMatch(/cpu {6}[▁▂▃▄▅▆▇█]{14} {3}12%/);
    expect(spanOf(h, "12%").fg.equals(color(tokens.text))).toBe(true);
    fits(h, cols);
  });
}

// ---- Radio, buttons, multi row, checkbox ----

for (const [cols, rows] of SIZES) {
  test(`radio, button row and checkbox row look like ( ) 16   (•) 18 and [x] 16   [ ] 18; ←→ move the choice and a click picks (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "choices", { cols, rows });
    expect(h.frame()).toContain("( ) 16   (•) 18   ( ) 20");
    expect(rowsOf(h)[rowIndex(h, "( ) 16")]).toContain("recomendada: 18");
    expect(h.frame()).toContain("Versão");
    expect(h.frame()).toMatch(/Modo +\s16\s+ 18 /); // button row: the chosen one is a chip
    expect(spanOf(h, " 16 ").bg.equals(color(tokens.accent))).toBe(true);
    expect(h.frame()).toContain("[x] 16   [ ] 18   [ ] 20");
    expect(spanOf(h, "[x]").fg.equals(color(tokens.accent))).toBe(true);
    expect(h.frame()).toContain("[x] lorem ipsum");
    // the label column is shared: every value starts at the same column
    expect(columnOf(h, "( ) 16")).toBe(columnOf(h, "[x] 16"));
    await h.press("ARROW_RIGHT"); // the radio has the focus: the choice moves to 20
    expect(h.frame()).toContain("( ) 16   ( ) 18   (•) 20");
    await h.press("ARROW_LEFT");
    await h.press("ARROW_LEFT");
    expect(h.frame()).toContain("(•) 16   ( ) 18   ( ) 20");
    await h.press("s", { ctrl: true });
    expect(h.frame()).toContain('"ver":"16"');
    h.destroy();

    h = await renderPage(MODULE, "choices", { cols, rows });
    await h.click(columnOf(h, "( ) 20") + 1, rowIndex(h, "( ) 20")); // the mouse picks
    expect(h.frame()).toContain("( ) 16   ( ) 18   (•) 20");
    await h.press("s", { ctrl: true });
    expect(h.frame()).toContain('"ver":"20"');
    fits(h, cols);
  });
}

test("a multi row: ←→ move the cursor, space marks; ↑↓ go to the next field", async () => {
  h = await renderPage(MODULE, "choices", { cols: 100, rows: 30 });
  await h.press("ARROW_DOWN"); // buttons
  await h.press("ARROW_DOWN"); // multi
  await h.press("ARROW_RIGHT");
  await h.press(" ");
  expect(h.frame()).toContain("[x] 16   [x] 18   [ ] 20");
  await h.press("ARROW_DOWN"); // the checkbox, not another option
  await h.press(" ");
  await h.press("s", { ctrl: true });
  expect(h.frame()).toContain('"extras":"16,18"');
  expect(h.frame()).toContain('"ativo":false');
});

test("a button-row choice picks as the arrows move it", async () => {
  h = await renderPage(MODULE, "choices", { cols: 100, rows: 30 });
  await h.press("ARROW_DOWN"); // buttons
  await h.press("ARROW_RIGHT");
  expect(spanOf(h, " 18 ").bg.equals(color(tokens.accent))).toBe(true);
  await h.press("s", { ctrl: true });
  expect(h.frame()).toContain('"modo":"18"');
});

// ---- CopyBlock ----

const bareHost = (): HostPage => ({ addKey: () => () => {}, pop: () => {} } as unknown as HostPage);
const CopyView = CopyBlock as (props: Parameters<typeof CopyBlock>[0]) => ReactNode;

test("copyText aligns the labels and trims the line ends", () => {
  expect(copyText([{ label: "acesso web", value: "https://10.0.0.1" }, { label: "senha", value: "Kq7" }])).toBe("acesso web  https://10.0.0.1\nsenha       Kq7");
});

for (const [cols, rows] of SIZES) {
  test(`CopyBlock: rows on the panel fill without a border, and the button copies the formatted text (${cols}x${rows})`, async () => {
    const got: string[] = [];
    const rowsData = [{ label: "acesso web", value: "https://10.0.0.1", tone: "ip" as const }, { label: "senha web", value: "senha-exemplo" }];
    h = await renderTui(
      <ThemeProvider><NudgeProvider><KeyRouter onQuit={() => {}}><HostCtx.Provider value={bareHost()}>
        <CopyProvider clipboard={async (text) => (got.push(text), { ok: true })}>
          <CopyView rows={rowsData} copyLabel="copiar acesso" title="acesso" />
        </CopyProvider>
      </HostCtx.Provider></KeyRouter></NudgeProvider></ThemeProvider>,
      { cols, rows },
    );
    expect(h.frame()).toContain("acesso web  https://10.0.0.1");
    expect(h.frame()).toContain("senha web   senha-exemplo");
    expect(h.frame()).not.toMatch(/[╭╮╰╯│]/); // no border
    expect(spanOf(h, "acesso web").bg.equals(color(tokens.panel))).toBe(true); // the subtle fill
    expect(spanOf(h, "https://10.0.0.1").fg.equals(color(tokens.ip))).toBe(true);
    expect(spanOf(h, "[ copiar acesso ]").bg.equals(color(tokens.accent))).toBe(false); // not focused: not filled
    expect(spanOf(h, "[ copiar acesso ]").fg.equals(color(tokens.accent))).toBe(true);
    await h.click(columnOf(h, "[ copiar acesso ]") + 2, rowIndex(h, "[ copiar acesso ]"));
    await h.flush();
    expect(got).toEqual(["acesso web  https://10.0.0.1\nsenha web   senha-exemplo"]);
  });
}

// ---- List ----

for (const [cols, rows] of SIZES) {
  test(`List: the selected » takes the width of the unselected indent, so the columns line up; hover fills the row (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "list", { cols, rows });
    const text = ["alfa", "beta", "gama"];
    const columns = text.map((name) => columnOf(h!, name));
    expect(new Set(columns).size).toBe(1); // one column for all three rows, selected or not
    expect(rowsOf(h)[rowIndex(h, "beta")]!.slice(0, columns[0]!)).toContain("»");
    expect(rowsOf(h)[rowIndex(h, "alfa")]!.slice(0, columns[0]!)).toMatch(/^\s*● $/); // the mark of another row takes the same cells
    expect(rowsOf(h)[rowIndex(h, "beta")]!.slice(0, columns[0]!)).toMatch(/»\s+$/);
    // hover: a subtle fill (the panel token), the selection does not move
    await h.hover(columnOf(h, "alfa") + 1, rowIndex(h, "alfa"));
    expect(spanOf(h, "alfa").bg.equals(color(tokens.panel))).toBe(true);
    expect(rowsOf(h)[rowIndex(h, "beta")]).toContain("»");
    expect(columnOf(h, "alfa")).toBe(columns[0]!); // hovering moves nothing
  });
}

// ---- Chips and Button states ----

for (const [cols, rows] of SIZES) {
  test(`filter chips (the chosen one filled) and the Button states: primary, secondary, danger, disabled with its reason (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "chips", { cols, rows });
    expect(spanOf(h, " todos ").bg.equals(color(tokens.accent))).toBe(true);
    expect(spanOf(h, " lorem ").bg.equals(color(tokens.panel))).toBe(true);
    expect(h.frame()).toContain("● ao vivo");
    expect(spanOf(h, "[ principal ]").bg.equals(color(tokens.accent))).toBe(false); // an unfocused primary is bold accent text
    expect(spanOf(h, "[ principal ]").fg.equals(color(tokens.accent))).toBe(true);
    expect(h.frame()).toContain("[ secundário ]");
    expect(spanOf(h, "[ secundário ]").fg.equals(color(tokens.accent))).toBe(true);
    expect(spanOf(h, "[ perigoso ]").fg.equals(color(tokens.error))).toBe(true);
    expect(spanOf(h, "[ desligado ]").fg.equals(color(tokens.dim))).toBe(true);
    expect(rowIndex(h, "falta o token")).toBe(rowIndex(h, "[ desligado ]") + 1); // the reason under the button
    fits(h, cols);
  });
}

test("buttonLook: every button is [ label ]; only a lit one fills; an unlit primary is bold accent text; disabled never fills", () => {
  const c = tokens;
  const idle = buttonLook("salvar", { primary: true }, c);
  expect(idle).toMatchObject({ text: "[ salvar ]", fg: c.accent, bold: true, underline: false });
  expect(idle.bg).toBeUndefined();
  expect(buttonLook("salvar", { primary: true, lit: true }, c)).toMatchObject({ bg: c.accent, bold: true, underline: true });
  const quiet = buttonLook("voltar", {}, c);
  const lit = buttonLook("voltar", { lit: true }, c);
  expect(quiet).toMatchObject({ text: "[ voltar ]", fg: c.accent });
  expect(quiet.bg).toBeUndefined();
  expect(lit).toMatchObject({ text: "[ voltar ]", bg: c.accent });
  expect(buttonLook("remover", { danger: true }, c).fg).toBe(c.error);
  expect(buttonLook("remover", { danger: true, lit: true }, c).bg).toBe(c.error);
  expect(buttonLook("x", { disabled: "motivo", lit: true, primary: true }, c)).toMatchObject({ fg: c.dim, text: "[ x ]" });
});

// ---- CommandResult ----

for (const [cols, rows] of SIZES) {
  test(`CommandResult: the title is Erro (no exit code), the details are dim, one blank row, then the buttons (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "failed", { cols, rows });
    expect(h.frame()).toContain("Erro");
    expect(h.frame()).not.toContain("saiu");
    expect(spanOf(h, "Erro").fg.equals(color(tokens.error))).toBe(true);
    expect(h.frame()).toContain("não aplicou as regras");
    expect(h.frame()).toContain("$ iptables-restore /etc/rules");
    expect(h.frame()).toContain("Bad argument");
    expect(h.frame()).not.toContain("linha 1"); // only the tail of the output
    expect(spanOf(h, "$ iptables-restore").fg.equals(color(tokens.dim))).toBe(true);
    expect(h.frame()).toContain("código de saída 3");
    const last = rowIndex(h, "código de saída 3");
    expect(rowsOf(h)[last + 1]!.trim()).toBe(""); // the one blank row
    expect(rowsOf(h)[last + 2]).toContain("[ fechar ]");
    expect(rowsOf(h)[last + 2]).toContain("[ copiar erro ]");
    expect(spanOf(h, "[ fechar ]").bg.equals(color(tokens.accent))).toBe(false); // not focused: not filled
    fits(h, cols);
  });
}

test("CommandResult: exit 1 shows no code line; success is Concluído in the success token", async () => {
  h = await renderPage(MODULE, "plain", { cols: 80, rows: 24 });
  expect(h.frame()).toContain("Erro");
  expect(h.frame()).not.toContain("código de saída");
  expect(rowsOf(h)[rowIndex(h, "arquivo não existe") + 1]!.trim()).toBe("");
  h.destroy();
  h = await renderPage(MODULE, "done", { cols: 80, rows: 24 });
  expect(h.frame()).toContain("Concluído");
  expect(spanOf(h, "Concluído").fg.equals(color(tokens.ok))).toBe(true);
  expect(rowsOf(h)[rowIndex(h, "regras reaplicadas") + 1]!.trim()).toBe("");
  expect(h.frame()).toContain("[ fechar ]");
});

// ---- Scroll ----

for (const [cols, rows] of SIZES) {
  test(`Scroll: a page taller than the screen scrolls by page, to the end and back (${cols}x${rows})`, async () => {
    h = await renderPage(MODULE, "tall", { cols, rows });
    expect(h.frame()).toContain("linha 1");
    expect(h.frame()).not.toContain("linha 60");
    for (let i = 0; i < 6; i++) await h.press(PAGE_DOWN);
    expect(h.frame()).toContain("linha 60");
    expect(h.frame()).not.toContain("linha 1\n");
    await h.press("HOME");
    expect(h.frame()).toContain("linha 1");
    await h.press("END");
    expect(h.frame()).toContain("linha 60");
  });
}

// ---- The top bar ----

const FIXED_NOW = new Date(2026, 9, 15, 13, 39, 4).getTime();

async function mountBar(cols: number, version: string, moduleTabs: number) {
  const registry = createRegistry();
  for (let index = 0; index < moduleTabs; index++) {
    registry.register({ id: `m${index}`, version: "1", entry: "x" }, { pages: { p: { title: "p", tab: { label: `Módulo ${index}` }, render: () => null } } });
  }
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  const store = createSessionStore({ registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history") });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version={version} now={() => FIXED_NOW} /> };
  return renderTui(<App root={root} logger={makeLogger("t")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} pages={{ session: store, registry, makeLogger }} />, { cols, rows: 24 });
}

for (const cols of [80, 120]) {
  test(`the bar: a dim │ between the last tab and the clock, a thin rule under it, and the short dev label (${cols} columns)`, async () => {
    h = await mountBar(cols, "0.1.2 (dev, +alpha +beta +gamma)", 0);
    const [bar, rule] = rowsOf(h);
    expect(bar).toContain("Sistema");
    expect(bar!.indexOf("│")).toBeGreaterThan(bar!.indexOf("Sistema") + "Sistema".length);
    // the date goes first when the tabs leave no room for it (80 columns), then the time
    expect(bar).toMatch(cols === 80 ? / │ 13:39:04 · pvx 0\.1\.2 dev \+3 *$/ : / │ qui 15\/10 13:39:04 · pvx 0\.1\.2 dev \+3 *$/);
    expect(bar!.match(/│/g)).toHaveLength(1);
    expect(rule!.trim()).toBe("─".repeat(cols - 2));
    expect(spanOf(h, "─".repeat(cols - 2)).fg.equals(color(tokens.border))).toBe(true);
    expect([...bar!].length).toBeLessThanOrEqual(cols);
  });
}

test("the bar never overlaps: with many tabs at 80 columns the date goes first, then the time, and the version stays whole", async () => {
  h = await mountBar(80, "0.1.2 (dev, +alpha +beta +gamma)", 5);
  const bar = rowsOf(h)[0]!;
  expect([...bar].length).toBeLessThanOrEqual(80);
  expect(bar).toContain("pvx 0.1.2 dev +3");
  expect(bar).not.toContain("qui 15/10"); // the date went first
  expect(bar).toMatch(/Módulo/); // the tabs are still there
  expect(bar.match(/pvx /g)).toHaveLength(1);
});

test("barVersion keeps any label that is not a dev build", () => {
  expect(barVersion("0.1.2 (dev, +a)")).toBe("0.1.2 dev +1");
  expect(barVersion("0.1.2")).toBe("0.1.2");
});

// ---- The scrollback in Comando ----

test("scrollback: the time sits inline before the command and the result lines start at the left margin, under the time", async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  const registry: Registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) });
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  const store = createSessionStore({ registry, makeLogger, historyPath: join(pvxHome(), "tui-history"), isRoot: true });
  const root = { id: "sessao", element: <Session store={store} registry={registry} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />, { cols: 100, rows: 24 });
  await h.type("demo greet ana");
  await h.press("RETURN");
  await h.flush();
  const header = rowsOf(h).find((row) => row.includes("demo greet ana") && row.includes("❯"))!;
  expect(header).toMatch(/^ {2}\d\d:\d\d:\d\d {2}❯ demo greet ana/); // the page padding and the block padding, then the time
  const result = rowsOf(h).find((row) => row.includes("[✓] oi ana"))!;
  expect(result.indexOf("[✓]")).toBe(2); // the page padding and the block padding: the column of the time
  expect(result.indexOf("[✓]")).toBe(header.search(/\d/));
});
