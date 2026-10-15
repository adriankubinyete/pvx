import { afterEach, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { createRegistry, loadModules, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { NudgeProvider, NudgeText } from "../src/nudge.tsx";
import { Palette, type SessionLike } from "../src/palette/Palette.tsx";
import { loadFavorites } from "../src/palette/favorites.ts";
import { buildLine } from "../src/palette/form.ts";
import { search } from "../src/palette/search.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

let registry: Registry;
beforeAll(async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  registry = createRegistry();
  const noop = { debug() {}, info() {}, warn() {}, error() {} };
  await loadModules(registry, { hostVersion: "1.0.0", makeLogger: () => noop });
});

const idle = { blocks: [], history: [], pending: [] }; // stable: useSyncExternalStore needs the same object

function fake(failing = "") {
  const calls: { line: string; secrets?: Record<string, string> }[] = [];
  const session: SessionLike = {
    history: ["demo greet ana"],
    answer() {},
    subscribe: () => () => {},
    getSnapshot: () => idle,
    async run(line, opts) {
      calls.push({ line, secrets: opts?.secrets });
      return { exit: line.startsWith(failing) && failing ? 1 : 0 };
    },
  };
  return { session, calls };
}

async function open(session: SessionLike) {
  let closed = 0;
  h = await renderTui(
    <ThemeProvider><NudgeProvider><KeyRouter onQuit={() => {}}><Palette session={session} registry={registry} onClose={() => closed++} /><NudgeText /></KeyRouter></NudgeProvider></ThemeProvider>,
  );
  return { closes: () => closed };
}

test("search ranks prefix before contains and marks destructive; scopes @ and !", () => {
  const keys = (q: string) => search(registry, q).map((x) => x.key);
  const r = keys("fix");
  expect(r.every((k) => k.includes("fix"))).toBe(true);
  expect(search(registry, "wip")[0]).toMatchObject({ key: "demo wipe", destructive: true });
  expect(search(registry, "demo")[0]!.range).toEqual([0, 4]);
  expect(keys("@cap").every((k) => k.startsWith("cap-fixture"))).toBe(true);
  expect(keys("!")).toEqual(["demo wipe"]);
  expect(keys("#x")).toEqual([]);
  expect(search(registry, "demo")[0]!.origin).toBe("usermodule");
});

test("typing a query shows ranked results with the destructive mark", async () => {
  await open(fake().session);
  await h!.type(">wipe");
  const f = h!.frame();
  expect(f).toMatch(/demo wipe .*!/); // the destructive mark is at the right of the row
  expect(f).not.toContain("demo greet");
});

test("queue runs in order and stops at the first failure; favorites persist", async () => {
  const ok = fake();
  const o = await open(ok.session);
  await h!.type("@cap");
  await h!.press("n", { ctrl: true });
  await h!.press("ARROW_DOWN");
  await h!.press("n", { ctrl: true });
  expect(h!.frame()).toContain("fila (2)");
  await h!.press("RETURN", { ctrl: true });
  await h!.flush();
  expect(ok.calls.map((c) => c.line)).toEqual(["cap-fixture fix-a", "cap-fixture fix-b"]);
  expect(o.closes()).toBe(1);
  h?.destroy();

  const bad = fake("cap-fixture fix-a");
  await open(bad.session);
  await h!.type("@cap");
  await h!.press("n", { ctrl: true });
  await h!.press("ARROW_DOWN");
  await h!.press("n", { ctrl: true });
  await h!.press("RETURN", { ctrl: true });
  await h!.flush();
  expect(bad.calls.map((c) => c.line)).toEqual(["cap-fixture fix-a"]);

  h?.destroy();
  await open(fake().session);
  await h!.type("@cap");
  await h!.press("f", { ctrl: true });
  expect(loadFavorites()).toEqual(["cap-fixture fix-a"]);
  await h!.press("f", { ctrl: true });
  expect(loadFavorites()).toEqual([]);
});

test("a running queue shows a spinner, ignores keys, and esc closes the palette once while the command goes on", async () => {
  const slow = fake();
  let finish = () => {};
  slow.session.run = async (line) => (slow.calls.push({ line }), await new Promise<void>((resolve) => (finish = resolve)), { exit: 0 });
  const o = await open(slow.session);
  await h!.type("@cap");
  await h!.press("n", { ctrl: true });
  await h!.press("RETURN", { ctrl: true });
  expect(h!.frame()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] rodando…/);
  await h!.press("RETURN", { ctrl: true });
  await h!.type("zz");
  expect(slow.calls).toHaveLength(1);
  expect(o.closes()).toBe(0);
  await h!.press("ESCAPE");
  expect(o.closes()).toBe(1);
  finish();
  await h!.flush();
  expect(o.closes()).toBe(1); // the finished queue does not close it again
});

test("form shows required *, masks the secret and keeps it out of the line and the history line", async () => {
  const { session, calls } = fake();
  await open(session);
  await h!.type(">login");
  await h!.press("TAB");
  await h!.type("s3cr3t");
  const f = h!.frame();
  expect(f).toContain("token*");
  expect(f).toContain("••••••");
  expect(f).not.toContain("s3cr3t");
  expect(f).toContain("$ pvx demo login");
  await h!.press("RETURN");
  await h!.flush();
  expect(calls).toEqual([{ line: "demo login", secrets: { token: "s3cr3t" } }]);

  const b = buildLine("demo login", registry.commands.get("demo login")!.args, { token: "s3cr3t" });
  expect(b.argv.join(" ") + b.display).not.toContain("s3cr3t");
});

test("→ enters the args; the cursor edits in place and ← at the start returns to the same command", async () => {
  await open(fake().session);
  await h!.type(">login");
  await h!.press("ARROW_RIGHT");
  expect(h!.frame()).toMatch(/» token\*/); // first field has focus
  await h!.type("abc");
  await h!.press("ARROW_LEFT");
  await h!.press("ARROW_LEFT");
  await h!.type("X");
  expect(h!.frame()).toMatch(/» token\* ••••/); // secret: masked, cursor moved, 4 chars
  expect(h!.frame()).toMatch(/» token\*/);
  await h!.press("HOME");
  await h!.press("ARROW_LEFT"); // crossing the start: back to the list
  expect(h!.frame()).not.toMatch(/» token\*/);
  expect(h!.frame()).toContain("$ pvx demo login"); // same command still selected
  await h!.press("ARROW_RIGHT");
  expect(h!.frame()).toMatch(/» token\*/);
});

test("palette form: a plain field shows aXbc after abc, ←, ←, X", async () => {
  await open(fake().session);
  await h!.type(">greet");
  await h!.press("ARROW_RIGHT");
  await h!.type("abc");
  await h!.press("ARROW_LEFT");
  await h!.press("ARROW_LEFT");
  await h!.type("X");
  expect(h!.frame()).toMatch(/aXbc/);
  expect(h!.frame()).toContain("$ pvx demo greet aXbc");
  await h!.press("HOME");
  await h!.press("ARROW_LEFT");
  expect(h!.frame()).toContain("$ pvx demo greet aXbc"); // same command selected
  expect(h!.frame()).not.toMatch(/» who/);
});

test("palette query: ← and → move the cursor and do not leave the query", async () => {
  await open(fake().session);
  await h!.type(">gret");
  await h!.press("ARROW_LEFT");
  await h!.press("ARROW_LEFT");
  await h!.type("e");
  expect(h!.frame()).toContain("› >greet");
});

test("→ on a command without args nudges \"sem argumentos\", and the notice goes away by itself", async () => {
  await open(fake().session);
  await h!.type(">wipe");
  await h!.press("ARROW_RIGHT");
  expect(h!.frame()).toContain("sem argumentos");
  await Bun.sleep(1700);
  await h!.flush();
  expect(h!.frame()).not.toContain("sem argumentos");
});

test("`#` pages: rows show the title (not the key), tab pages carry an `aba` tag", async () => {
  const pages = search(registry, "#");
  expect(pages.length).toBeGreaterThan(0);
  expect(search(registry, "#quadro")[0]).toMatchObject({ key: "ui-demo.board", label: "Quadro", tab: true, range: [0, 6] });
  expect(search(registry, "#ui-demo.board")[0]).toMatchObject({ key: "ui-demo.board", range: null }); // found by key, nothing to highlight in the title
  expect(search(registry, "#ui-demo.counter")[0]).toMatchObject({ label: "Contador", tab: false });
  expect(search(registry, "#visão")[0]).toMatchObject({ key: "ui-demo.overview", range: [0, 5] });
  await open(fake().session);
  await h!.type("#ui-demo");
  const f = h!.frame();
  expect(f).toMatch(/Quadro\s+ui-demo · aba/); // the title, then where the page is, with the `aba` tag for a tab
  expect(f).toMatch(/Contador\s+ui-demo(?! · aba)/);
  expect(f).not.toContain("§ ui-demo.");
  expect(f).toContain("páginas");
});

test("`#` page whose title equals the module id is not printed twice as a key", async () => {
  const reg = createRegistry();
  const noop = { debug() {}, info() {}, warn() {}, error() {} };
  const { builtin } = await import("../../builtin/index.ts");
  const { ui } = await import("../src/index.ts");
  await loadModules(reg, { hostVersion: "1.0.0", makeLogger: () => noop, ui, builtin });
  expect(search(reg, "#conformidade")[0]).toMatchObject({ key: "conformidade.conformidade", label: "conformidade", range: [0, 12] });
  expect(search(reg, "#conformidade.conformidade")).toHaveLength(1); // by key too
  let closed = 0;
  h = await renderTui(
    <ThemeProvider><NudgeProvider><KeyRouter onQuit={() => {}}><Palette session={fake().session} registry={reg} onClose={() => closed++} /></KeyRouter></NudgeProvider></ThemeProvider>,
  );
  await h.type("#conf");
  const f = h.frame();
  expect(f).not.toContain("conformidade.conformidade");
  expect(f).toMatch(/páginas[^\n]*\n[^\n]*conformidade\s+conformidade/); // the title, then the module
});

// ---- the redesigned dialog ----

const rows = () => h!.frame().split("\n");

test.each([[80, 24], [120, 40]] as const)("the dialog at %ix%i: one border, the query on top, a rule, grouped results, a rule and one dim footer line", async (cols, height) => {
  h = await renderTui(
    <ThemeProvider><NudgeProvider><KeyRouter onQuit={() => {}}><Palette session={fake().session} registry={registry} onClose={() => {}} /></KeyRouter></NudgeProvider></ThemeProvider>,
    { cols, rows: height },
  );
  await h.type("gre");
  const f = h.frame();
  for (const l of rows()) expect(l.length).toBeLessThanOrEqual(cols);
  expect(f.match(/╭/g)).toHaveLength(1); // a single border: the dialog floats, nothing nests in it
  expect(f).toContain("comandos");
  expect(rows().filter((l) => l.includes("enter roda · tab completa · ctrl+f favorito · esc fecha"))).toHaveLength(1);
  const query = rows().findIndex((l) => l.includes("› gre"));
  expect(rows()[query + 1]).toMatch(/│ ─{20,} │/); // the rule under the query
  expect(rows()[rows().findIndex((l) => l.includes("enter roda ·")) - 1]).toMatch(/│ ─{20,} │/); // and the rule over the footer
  const selected = rows().find((l) => l.includes("» demo greet"))!;
  expect(selected).toMatch(/enter/); // the key that runs the selected row, at its right edge
});

test("an empty query shows favorites and recent commands, then the commands (and below them the pages)", async () => {
  const { session } = fake();
  await open({ ...session, history: ["demo greet ana", "cap-fixture fix-a"] });
  const f = h!.frame();
  const order = ["recentes", "comandos"].map((word) => f.indexOf(word)); // the pages come after, below the ten rows in view
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(f).toContain("@módulo  >comando  #página  !destrutivo");
});

test("words in the query match in order and mark their letters: `dem gr` finds demo greet and marks `dem` and `gr`", async () => {
  expect(search(registry, "dem gr")[0]).toMatchObject({ key: "demo greet", ranges: [[0, 3], [5, 7]] });
  expect(search(registry, "dem gr").map((x) => x.key)).not.toContain("demo wipe");
  expect(search(registry, "gr dem")).toEqual([]); // out of order
  expect(search(registry, "demo")[0]!.ranges).toEqual([[0, 4]]);
  await open(fake().session);
  await h!.type("dem gr");
  const y = rows().findIndex((l) => l.includes("demo greet"));
  const spans = h!.spans().lines[y]!.spans;
  const marked = spans.filter((span) => (span.attributes & 1) !== 0 && /^(dem|gr)$/.test(span.text)).map((span) => span.text);
  expect(marked).toEqual(["dem", "gr"]); // the matched letters are bold in the accent
});

test("the selected row has the fill, the others none; the dialog keeps ↓ walking across the groups", async () => {
  await open(fake().session);
  await h!.type("demo");
  const selected = rows().findIndex((l) => l.includes("»"));
  expect(rows().filter((l) => l.includes("»"))).toHaveLength(1);
  await h!.press("ARROW_DOWN");
  expect(rows().findIndex((l) => l.includes("»"))).toBeGreaterThan(selected);
});
