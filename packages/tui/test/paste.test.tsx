import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, tuiStatePath, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, KeyRouter, Session, Tabs, ThemeProvider } from "../src/index.ts";
import { Palette, type SessionLike } from "../src/palette/Palette.tsx";
import { HostCtx, type HostPage } from "../src/sdk-ui/host.tsx";
import { Fields } from "../src/sdk-ui/fields.tsx";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

let registry: Registry;
beforeAll(async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  registry = createRegistry();
  const noop = { debug() {}, info() {}, warn() {}, error() {} };
  await loadModules(registry, { hostVersion: "1.0.0", makeLogger: () => noop });
});

const SECRET = "hunter2-pasted-s3cret";
/** 4 KB, far wider than any field. */
const LONG = "k".repeat(4096);

type Props = Parameters<typeof Fields>[0];
const Form = Fields as (p: Props) => ReactNode;
const fields = [
  { id: "user", label: "usuário", kind: "line" as const },
  { id: "pw", label: "senha", kind: "secret" as const },
  { id: "deny", label: "bloquear", kind: "toggle" as const },
];
async function mount() {
  const submitted: Record<string, string | boolean>[] = [];
  const host = { addKey: () => () => {} } as unknown as HostPage;
  h = await renderTui(
    <ThemeProvider><KeyRouter onQuit={() => {}}><HostCtx.Provider value={host}>
      <Form fields={fields} onSubmit={(values) => void submitted.push(values)} onCancel={() => {}} />
    </HostCtx.Provider></KeyRouter></ThemeProvider>,
    { cols: 80, rows: 24 },
  );
  return { t: h, submitted };
}

test("form: a paste goes into a normal field at the cursor, joined and without the trailing newline", async () => {
  const { t, submitted } = await mount();
  await t.type("ac");
  await t.press("ARROW_LEFT");
  await t.paste("b\r\nb\n");
  expect(t.frame()).toContain("abbc");
  await t.press("s", { ctrl: true });
  expect(submitted[0]!.user).toBe("abbc");
});

test("form: a pasted secret is masked, reaches the values and is never on screen; 4 KB does not overflow", async () => {
  const { t, submitted } = await mount();
  await t.press("ARROW_DOWN");
  await t.paste(`${SECRET}\n`);
  expect(t.frame()).toContain("••••");
  expect(t.frame()).not.toContain(SECRET);
  await t.paste(LONG);
  expect(t.frame()).not.toContain("kkkk");
  expect(t.frame().split("\n").every((row) => [...row].length <= 80)).toBe(true);
  await t.press("s", { ctrl: true });
  expect(submitted[0]!.pw).toBe(SECRET + LONG);
});

test("form: a paste on a toggle does nothing", async () => {
  const { t, submitted } = await mount();
  await t.press("ARROW_DOWN");
  await t.press("ARROW_DOWN");
  await t.paste("x y z");
  await t.press("s", { ctrl: true });
  expect(submitted[0]).toMatchObject({ user: "", pw: "", deny: false });
});

const idle = { blocks: [], history: [], pending: [] };

test("palette: a paste goes into the search and into a secret field; the secret reaches the command, not the frame", async () => {
  const calls: { line: string; secrets?: Record<string, string> }[] = [];
  const session: SessionLike = {
    history: [],
    answer() {},
    subscribe: () => () => {},
    getSnapshot: () => idle,
    async run(line, opts) {
      calls.push({ line, secrets: opts?.secrets });
      return { exit: 0 };
    },
  };
  h = await renderTui(<ThemeProvider><KeyRouter onQuit={() => {}}><Palette session={session} registry={registry} onClose={() => {}} /></KeyRouter></ThemeProvider>);
  await h.paste(">login");
  expect(h.frame()).toContain("demo login");
  await h.press("TAB");
  await h.paste(`${SECRET}\n`);
  expect(h.frame()).toContain("•".repeat(SECRET.length));
  expect(h.frame()).not.toContain(SECRET);
  await h.press("RETURN");
  await h.flush();
  expect(calls).toEqual([{ line: "demo login", secrets: { token: SECRET } }]);
});

let store: ReturnType<typeof createSessionStore>;
const historyPath = () => join(pvxHome(), "tui-history");
async function mountSession() {
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  store = createSessionStore({ registry, makeLogger, historyPath: historyPath(), isRoot: true });
  const root = { id: "sessao", element: <Session store={store} registry={registry} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} />);
  return h;
}
beforeEach(() => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
});

test("Comando line: a paste is inserted and runs like typed; the host secret modal masks it and leaks it nowhere", async () => {
  const t = await mountSession();
  await t.paste("demo greet ana\n");
  expect(t.frame()).toContain("❯ demo greet ana");
  await t.press("RETURN");
  await t.flush();
  expect(t.frame()).toContain("[✓] oi ana");

  await t.paste("demo login");
  await t.press("RETURN");
  await t.flush();
  expect(t.frame()).toContain("token:");
  await t.paste(`${SECRET}\n`);
  expect(t.frame()).toContain("•".repeat(SECRET.length));
  expect(t.frame()).not.toContain(SECRET);
  await t.press("RETURN");
  await t.flush();
  expect(t.frame()).toContain(`token com ${SECRET.length} chars`);
  expect(t.frame()).not.toContain(SECRET);
  const files = [historyPath(), ...readdirSync(logsDir()).map((f) => join(logsDir(), f))];
  for (const file of files) expect(readFileSync(file, "utf8")).not.toContain(SECRET);
});

test("a paste with the tab bar focused does nothing, not even on the Comando tab", async () => {
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  const tabsStore = createSessionStore({ registry, makeLogger, isRoot: true, historyPath: historyPath() });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={tabsStore} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} /> };
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={tuiStatePath()} />);
  await h.press("TAB");
  await h.press("ARROW_LEFT"); // Início, bar focused
  const text = "q r x l c 1 2 3 ? /";
  const home = h.frame();
  await h.paste(text);
  expect(h.frame()).toBe(home);
  for (let i = 0; i < 3; i++) await h.press("TAB"); // inicio > modulos > logs > comando
  const comando = h.frame();
  await h.paste(text);
  expect(h.frame()).toBe(comando);
  expect(h.frame()).not.toContain("q r x");
});
