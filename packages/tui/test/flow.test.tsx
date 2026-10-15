import { afterEach, expect, test } from "bun:test";
import { useState, type ReactNode } from "react";
import { RGBA } from "@opentui/core";
import type { CellItem, Question } from "@pvx/sdk";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider, tokens } from "../src/index.ts";
import { NudgeProvider, NudgeText } from "../src/nudge.tsx";
import { HostCtx, type HostPage } from "../src/sdk-ui/host.tsx";
import { Button, CellGrid, Conversation, Loading, ProgressBar, useAsync } from "../src/sdk-ui/flow.tsx";
import { CopyPreview, CopyProvider, useCopy } from "../src/sdk-ui/copy.tsx";

const Conv = Conversation as (p: Parameters<typeof Conversation>[0]) => ReactNode;
const Btn = Button as (p: Parameters<typeof Button>[0]) => ReactNode;
const Bar = ProgressBar as (p: Parameters<typeof ProgressBar>[0]) => ReactNode;
const Grid = CellGrid as (p: Parameters<typeof CellGrid>[0]) => ReactNode;
const Load = Loading as (p: Parameters<typeof Loading>[0]) => ReactNode;

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

/** A bare page host: it records the footer rows (`keys label`) and runs them like the page does. */
function fakeHost() {
  const rows: { keys: string; label: string; run(): void }[] = [];
  let pops = 0;
  const host = { addKey: (s: (typeof rows)[number]) => (rows.push(s), () => void rows.splice(rows.indexOf(s), 1)), pop: () => void pops++ } as unknown as HostPage;
  return { host, rows, pops: () => pops };
}
const wrap = (host: HostPage, el: ReactNode) => (
  <ThemeProvider><NudgeProvider><KeyRouter onQuit={() => {}}><HostCtx.Provider value={host}>{el}</HostCtx.Provider></KeyRouter></NudgeProvider></ThemeProvider>
);
const at = (t: TuiHarness, text: string): [number, number] => {
  const rows = t.frame().split("\n");
  const y = rows.findIndex((r) => r.includes(text));
  if (y < 0) throw new Error(`"${text}" not on screen:\n${t.frame()}`);
  return [rows[y]!.indexOf(text), y];
};
const until = async (pred: () => boolean, ms = 3000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms && !pred(); ) (await Bun.sleep(20), await h!.flush());
  expect(pred(), h!.frame()).toBe(true);
};

// ---- Conversation ----

const questions: Question[] = [
  { id: "ver", title: "Versão", field: { id: "ver", label: "", kind: "choice", options: [{ value: "18", label: "18", detail: "recomendado" }, { value: "16", label: "16" }] } },
  { id: "name", title: "Nome", field: { id: "name", label: "", kind: "line" } },
  { id: "pk", title: "Pacotes extras", skip: true, field: { id: "pk", label: "", kind: "multi", options: [{ value: "lic", label: "licenciados" }, { value: "bl", label: "blocklist" }] } },
];
interface Log { answers: [string, string | boolean][]; confirmed: Record<string, string | boolean>[]; cancels: number }

async function mountConv(extra: Partial<Parameters<typeof Conversation>[0]> = {}, size = { cols: 80, rows: 24 }) {
  const log: Log = { answers: [], confirmed: [], cancels: 0 };
  const fh = fakeHost();
  function Stateful() {
    const [answers, setAnswers] = useState<Record<string, string | boolean>>({ pk: "lic,bl" });
    return (
      <Conv questions={questions} answers={answers} header={<text>cabeçalho</text>} footerSummary={<text>leva 20 min</text>} confirmLabel="instalar" onCancel={() => void log.cancels++}
        onAnswer={(id, v) => (log.answers.push([id, v]), setAnswers((a) => ({ ...a, [id]: v })))} onConfirm={(a) => void log.confirmed.push(a)} {...extra} />
    );
  }
  h = await renderTui(wrap(fh.host, <Stateful />), size);
  return { t: h, log, fh };
}

test("Conversation: asks one question at a time, collapses answers, then confirm lists skipped ones as (padrão)", async () => {
  const { t, log } = await mountConv();
  let f = t.frame();
  expect(f).toContain("cabeçalho");
  expect(f).toContain("? Versão");
  expect(f).toContain("(●) 18");
  expect(f).toContain("○ Nome"); // the next pending one
  expect(f).not.toContain("Pacotes extras"); // skipped: not in the flow
  await t.press("RETURN"); // choose 18
  f = t.frame();
  expect(f).toMatch(/✓ Versão +18/);
  expect(f).toContain("? Nome");
  expect(log.confirmed).toEqual([]);
  await t.type("pbx");
  await t.press("RETURN");
  f = t.frame();
  expect(f).toMatch(/✓ Nome +pbx/);
  expect(f).toMatch(/✓ Pacotes extras +licenciados, blocklist +\(padrão\)/);
  expect(f).toContain("leva 20 min");
  expect(f).toContain(" instalar ");
  expect(log.answers).toEqual([["ver", "18"], ["name", "pbx"]]);
  expect(log.confirmed).toEqual([]); // nothing commits before the button
  await t.press("RETURN"); // the cursor starts on the primary button
  expect(log.confirmed).toEqual([{ pk: "lic,bl", ver: "18", name: "pbx" }]);
});

test("Conversation: up moves into the answered list, enter reopens in place, re-confirming returns to the open question", async () => {
  const { t, log } = await mountConv();
  await t.press("RETURN"); // ver = 18
  await t.type("ab"); // typing in the open question (kept while parked)
  await t.press("ARROW_UP"); // top of the question -> the answered list
  expect(t.frame()).toMatch(/» Versão +18/);
  await t.press("RETURN"); // reopen in place
  expect(t.frame()).toContain("? Versão");
  expect(t.frame()).toContain("? Nome"); // the open question stays on screen, parked
  await t.press("ARROW_DOWN"); // 18 -> 16
  await t.press("RETURN"); // choose 16
  expect(log.answers.at(-1)).toEqual(["ver", "16"]);
  expect(t.frame()).toMatch(/✓ Versão +16/);
  await t.type("c"); // focus is back on the open question, its text kept
  await t.press("RETURN");
  expect(log.answers.at(-1)).toEqual(["name", "abc"]);
  expect(t.frame()).toContain(" instalar ");
});

test("Conversation: esc cancels a reopened question without changing the answer; down returns to the question", async () => {
  const { t, log } = await mountConv();
  await t.press("RETURN");
  await t.press("ARROW_UP");
  await t.press("RETURN");
  await t.press("ARROW_DOWN");
  await t.press(" "); // picks 16 but does not confirm
  await t.press("ESCAPE");
  expect(t.frame()).toMatch(/» Versão +18/); // back on the line, old answer
  expect(log.answers).toEqual([["ver", "18"]]);
  await t.press("ARROW_DOWN");
  await t.type("x"); // the question has the keyboard again
  expect(t.frame()).toContain("x");
  await t.press("ESCAPE"); // top level: onCancel
  expect(log.cancels).toBe(1);
});

test("Conversation: in the confirm step every row, skipped ones too, is editable; editing drops (padrão)", async () => {
  const { t, log } = await mountConv();
  await t.press("RETURN");
  await t.type("pbx");
  await t.press("RETURN");
  await t.press("ARROW_UP"); // last row: Pacotes extras
  expect(t.frame()).toMatch(/» Pacotes extras/);
  await t.press("RETURN");
  await t.press(" "); // uncheck the first option (cursor starts on it)
  await t.press("RETURN");
  expect(log.answers.at(-1)).toEqual(["pk", "bl"]);
  expect(t.frame()).toMatch(/» Pacotes extras +blocklist\s*$/m); // back on its row, no "(padrão)" now
  expect(t.frame()).not.toContain("(padrão)");
  await t.press("ARROW_DOWN"); // primary button
  await t.press("ARROW_DOWN"); // [ cancelar ]
  await t.press("RETURN");
  expect(log.cancels).toBe(1);
  expect(log.confirmed).toEqual([]);
});

test("Conversation: a click on an answered line reopens it; ctrl+enter confirms from the confirm step", async () => {
  const { t, log, fh } = await mountConv();
  await t.press("RETURN");
  const [x, y] = at(t, "Versão");
  await t.click(x + 1, y);
  expect(t.frame()).toContain("? Versão");
  await t.press("RETURN"); // re-confirm 18
  await t.type("pbx");
  await t.press("RETURN");
  expect(fh.rows.some((r) => r.keys === "ctrl+enter" && r.label === "instalar")).toBe(true); // the footer row of the button
  fh.rows.find((r) => r.keys === "ctrl+enter")!.run();
  expect(log.confirmed).toHaveLength(1);
  const [bx, by] = at(t, " instalar ");
  await t.click(bx + 2, by);
  expect(log.confirmed).toHaveLength(2);
});

test("Conversation: secret answers are masked on the collapsed line; 120x40 frame fits", async () => {
  const qs: Question[] = [{ id: "pw", title: "Senha", field: { id: "pw", label: "", kind: "secret" } }];
  const fh = fakeHost();
  function Stateful() {
    const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
    return <Conv questions={qs} answers={answers} onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} onConfirm={() => {}} />;
  }
  h = await renderTui(wrap(fh.host, <Stateful />), { cols: 120, rows: 40 });
  await h.type("segredo");
  await h.press("RETURN");
  expect(h.frame()).toMatch(/✓ Senha +●{8}/);
  expect(h.frame()).not.toContain("segredo");
  expect(h.frame().split("\n").every((l) => [...l].length <= 120)).toBe(true);
});

// ---- Button ----

test("Button: click and key press it; the key reaches the footer rows", async () => {
  const fh = fakeHost();
  let n = 0;
  h = await renderTui(wrap(fh.host, <Btn label="instalar" primary keys="ctrl+enter" onPress={() => void n++} />), { cols: 80, rows: 24 });
  expect(h.frame()).toContain(" instalar ");
  await h.click(3, 0);
  expect(n).toBe(1);
  expect(fh.rows).toHaveLength(1);
  fh.rows[0]!.run();
  expect(n).toBe(2);
  const accent = RGBA.fromHex(tokens.accent);
  expect(h.spans().lines[0]!.spans.some((s) => s.text.includes(" instalar ") && s.bg.equals(accent))).toBe(true);
});

test("Button: without keys it registers nothing", async () => {
  const fh = fakeHost();
  h = await renderTui(wrap(fh.host, <Btn label="ok" onPress={() => {}} />), { cols: 40, rows: 4 });
  expect(fh.rows).toHaveLength(0);
});

// ---- ProgressBar ----

/** The colours of the bar cells of row 0, left to right. */
const barColors = (t: TuiHarness) => {
  const out: string[] = [];
  const accent = RGBA.fromHex(tokens.accent), err = RGBA.fromHex(tokens.error), dim = RGBA.fromHex(tokens.dim);
  for (const s of t.spans().lines[0]!.spans) for (const ch of s.text) if (ch === "█" || ch === "░") out.push(s.fg.equals(accent) ? "a" : s.fg.equals(err) ? "e" : s.fg.equals(dim) ? "d" : "?");
  return out.join("");
};

test("ProgressBar: running shows the percentage and the times, and stretches to the width at 80 and 120", async () => {
  const el = <ThemeProvider><Bar value={0.44} startedAt={Date.now() - 724_000} etaMs={1_300_000} /></ThemeProvider>;
  h = await renderTui(el, { cols: 80, rows: 5 });
  let f = h.frame().split("\n")[0]!;
  expect(f).toMatch(/ 44%  12m04s · faltam ~9m\d\ds/);
  expect([...f.trimEnd()].length).toBeGreaterThanOrEqual(78);
  const w80 = barColors(h).length;
  await h.resize(120, 5);
  f = h.frame().split("\n")[0]!;
  expect([...f.trimEnd()].length).toBeGreaterThanOrEqual(118);
  expect(barColors(h).length).toBeGreaterThan(w80 + 30);
  expect(barColors(h)).toMatch(/^a+d+$/);
});

test("ProgressBar: failed paints the stop point red, contiguous with the filled part; done fills it", async () => {
  h = await renderTui(<ThemeProvider><Bar value={0.5} startedAt={Date.now() - 60_000} state="failed" /></ThemeProvider>, { cols: 80, rows: 5 });
  const colors = barColors(h);
  expect(colors).toMatch(/^a+e+d+$/); // no gap between the filled part and the red segment
  expect(h.frame()).toContain("falhou em 1m00s");
  h.destroy();
  h = await renderTui(<ThemeProvider><Bar value={0.2} startedAt={Date.now() - 5000} state="done" /></ThemeProvider>, { cols: 80, rows: 5 });
  expect(barColors(h)).toMatch(/^a+$/);
  expect(h.frame()).toContain("100%");
  expect(h.frame()).toContain("concluído em 5s");
});

test("ProgressBar: failed at 0% and at 100% still paints a red cell", async () => {
  for (const value of [0, 1]) {
    h = await renderTui(<ThemeProvider><Bar value={value} state="failed" /></ThemeProvider>, { cols: 80, rows: 5 });
    expect(barColors(h)).toContain("e");
    h.destroy();
  }
});

// ---- CellGrid ----

const cells = (n: number): CellItem[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, label: `pacote ${i}`, state: i < 20 ? "done" : i < 23 ? "running" : i === 23 ? "failed" : "pending" }));

test("CellGrid: wraps to the width, one cell wide per glyph, with a legend of the counts", async () => {
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Grid cells={cells(60)} /></KeyRouter></ThemeProvider>, { cols: 60, rows: 12 });
  let rows = h.frame().split("\n");
  expect(rows[0]).toContain("■ 20 concluído  ■ 3 rodando  ■ 1 falhou  ■ 36 pendente");
  const glyphs = (r: string) => r.trimEnd().replace(/ /g, "");
  expect([...rows[1]!.trimEnd()].length).toBe(59); // 30 cells of glyph + space: the last space is trimmed
  expect(glyphs(rows[1]!)).toBe("■".repeat(20) + "■".repeat(3) + "■" + "■".repeat(6));
  expect(glyphs(rows[2]!)).toBe("■".repeat(30));
  expect(rows.every((r) => [...r].length <= 60)).toBe(true);
  h.destroy();
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Grid cells={cells(60)} /></KeyRouter></ThemeProvider>, { cols: 120, rows: 12 });
  rows = h.frame().split("\n");
  expect(glyphs(rows[1]!)).toHaveLength(60); // all 60 on one row at 120 columns
  expect(rows[2]!.trim()).toBe("");
  h.destroy();
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Grid cells={cells(60)} /></KeyRouter></ThemeProvider>, { cols: 40, rows: 12 });
  rows = h.frame().split("\n");
  for (const w of ["■ 20 concluído", "■ 3 rodando", "■ 1 falhou", "■ 36 pendente"]) expect(h.frame()).toContain(w); // the legend wraps instead of being cut
  expect(rows.every((r) => [...r].length <= 40)).toBe(true);
});

test("CellGrid: tones, hover moves the selection (when focused) and shows the label, click and enter call onPress", async () => {
  const pressed: string[] = [];
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Grid cells={cells(70)} focused onPress={(id) => void pressed.push(id)} /></KeyRouter></ThemeProvider>, { cols: 60, rows: 12 });
  const colorAt = (x: number, y: number) => {
    let col = 0;
    for (const s of h!.spans().lines[y]!.spans) {
      if (x < col + s.width) return s.fg;
      col += s.width;
    }
  };
  expect(colorAt(0, 1)!.equals(RGBA.fromHex(tokens.accent))).toBe(true); // done
  expect(colorAt(2 * 20, 1)!.equals(RGBA.fromHex(tokens.info))).toBe(true); // cell 20: running
  expect(colorAt(2 * 23, 1)!.equals(RGBA.fromHex(tokens.error))).toBe(true); // cell 23: failed
  expect(colorAt(2 * 24, 1)!.equals(RGBA.fromHex(tokens.border))).toBe(true); // cell 24: pending, the faint border token
  await h.hover(2 * 4, 1); // cell p4
  expect(h.frame()).toContain("pacote 4  concluído");
  await h.click(2 * 5, 1);
  expect(pressed).toEqual(["p5"]);
  await h.press("ARROW_RIGHT");
  await h.press("RETURN");
  expect(pressed).toEqual(["p5", "p6"]);
  await h.press("ARROW_DOWN"); // 30 per row
  await h.press("RETURN");
  expect(pressed.at(-1)).toBe("p36");
  expect(h.frame()).toContain("pacote 36  pendente");
});

test("CellGrid: without focus the keyboard is left to the page", async () => {
  const pressed: string[] = [];
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Grid cells={cells(10)} onPress={(id) => void pressed.push(id)} /></KeyRouter></ThemeProvider>, { cols: 40, rows: 8 });
  await h.press("RETURN");
  expect(pressed).toEqual([]);
});

// ---- Loading and useAsync ----

test("Loading: a spinner that ticks beside the text", async () => {
  h = await renderTui(<ThemeProvider><Load label="lendo o catálogo…" /></ThemeProvider>, { cols: 40, rows: 3 });
  expect(h.frame().split("\n")[0]).toMatch(/^\S lendo o catálogo…/);
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    seen.add(h.frame()[0]!);
    await Bun.sleep(120);
    await h.flush();
  }
  expect(seen.size).toBeGreaterThan(1);
});

function AsyncView({ fn, dep }: { fn: () => Promise<string>; dep: number }) {
  const a = useAsync(fn, [dep]);
  return <text>{`loading=${a.loading} data=${a.data ?? "-"} error=${a.error ?? "-"}`}<span>{" "}</span></text>;
}

test("useAsync: loading, then data; a failure gives error; deps re-run and keep the last data meanwhile; a stale call is dropped", async () => {
  let release: (v: string) => void = () => {};
  const slow = () => new Promise<string>((r) => (release = r));
  h = await renderTui(<ThemeProvider><AsyncView fn={slow} dep={1} /></ThemeProvider>, { cols: 60, rows: 3 });
  expect(h.frame()).toContain("loading=true data=-");
  release("um");
  await until(() => h!.frame().includes("loading=false data=um"));
  h.destroy();
  h = await renderTui(<ThemeProvider><AsyncView fn={async () => { throw new Error("quebrou"); }} dep={1} /></ThemeProvider>, { cols: 60, rows: 3 });
  await until(() => h!.frame().includes("error=quebrou"));
  h.destroy();

  const calls: ((v: string) => void)[] = [];
  const gated = () => new Promise<string>((r) => calls.push(r));
  function Dep() {
    const [d, setD] = useState(1);
    return <box><AsyncView fn={gated} dep={d} /><box onMouseDown={() => setD(2)}><text>troca</text></box></box>;
  }
  h = await renderTui(<ThemeProvider><Dep /></ThemeProvider>, { cols: 60, rows: 4 });
  calls[0]!("a");
  await until(() => h!.frame().includes("data=a"));
  const [x, y] = at(h, "troca");
  await h.click(x, y);
  await until(() => calls.length === 2);
  expect(h.frame()).toContain("loading=true data=a"); // the old data stays while it re-runs
  await h.click(x, y); // same dep: no new call
  calls[1]!("b");
  await until(() => h!.frame().includes("loading=false data=b"));
});

test("useAsync: a result that arrives after the unmount is dropped without a warning", async () => {
  let release: (v: string) => void = () => {};
  h = await renderTui(<ThemeProvider><AsyncView fn={() => new Promise<string>((r) => (release = r))} dep={1} /></ThemeProvider>, { cols: 60, rows: 3 });
  h.destroy();
  release("tarde"); // must not throw or set state
  await Bun.sleep(20);
});

// ---- useCopy ----

function CopyButton({ text, title }: { text: string; title?: string }) {
  const copy = useCopy();
  return <box onMouseDown={() => void copy(text, { title })}><text>copiar</text></box>;
}
const copyApp = (text: string, clip: Parameters<typeof CopyProvider>[0]["clipboard"], previewMs = 60_000) => (
  <ThemeProvider><NudgeProvider><CopyProvider clipboard={clip} previewMs={previewMs}>
    <box flexDirection="column" height="100%"><box flexGrow={1}><CopyButton text={text} title="comando" /><CopyPreview /></box><NudgeText /></box>
  </CopyProvider></NudgeProvider></ThemeProvider>
);

test("useCopy: copies through the injected clipboard, previews exactly the lines and nudges copiado", async () => {
  const got: string[] = [];
  const text = "pvx issabel netinstall \\\n  --astver 18 --yes";
  h = await renderTui(copyApp(text, async (t) => (got.push(t), { ok: true })), { cols: 80, rows: 24 });
  await h.click(2, 0);
  await until(() => h!.frame().includes("✓ copiado"));
  expect(got).toEqual([text]);
  const f = h.frame();
  expect(f).toContain("pvx issabel netinstall \\");
  expect(f).toContain("  --astver 18 --yes");
  expect(f).toContain("✓ comando"); // the panel title
  expect(f).toContain("╭");
});

test("useCopy: an unavailable clipboard says so, keeps the preview and resolves false; the preview goes away after previewMs", async () => {
  h = await renderTui(copyApp("segredo-nao", async () => ({ ok: false, reason: "sem área de transferência" }), 150), { cols: 100, rows: 24 });
  await h.click(2, 0);
  await until(() => h!.frame().includes("não copiou: sem área de transferência"));
  expect(h.frame()).toContain("segredo-nao");
  expect(h.frame()).toContain("não copiado");
  await until(() => !h!.frame().includes("segredo-nao"));
});
