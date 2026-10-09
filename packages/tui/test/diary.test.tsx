import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, markSeen, pvxHome, type DiaryEntry, type Kind, runCapture, type Registry } from "@pvx/core";
import { builtin } from "../../builtin/index.ts";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme, ui } from "../src/index.ts";
import { parseConformity } from "../src/tabs/home.ts";
import { dayRows, detailLines, filterEntries } from "../src/tabs/diary.ts";

const fixtures = join(import.meta.dir, "../../core/test/fixtures");
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());
const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} });
const makeLogger = (n: string) => createLogger(logsDir(), n);
let registry: Registry;
beforeEach(async () => {
  process.env.PVX_USERMODULES = join(fixtures, "usermodules");
  process.env.SUDO_USER = "me";
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: quiet, ui, builtin });
});

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const jsonl = (f: string, ...ev: object[]) => writeFileSync(join(pvxHome(), f), ev.map((e) => `${JSON.stringify(e)}\n`).join(""), { flag: "a" });
function fixtureFiles() {
  jsonl("conformity.jsonl", { v: 1, at: ago(1), id: "firewall.asterisk-ips", from: "ok", to: "error", text: "IP no Asterisk fora da whitelist" });
  jsonl("audit.jsonl",
    { v: 1, at: ago(2), kind: "cmd", user: "carlos", line: "firewall apply", exit: 0, ms: 40, destructive: true },
    { v: 1, at: ago(4), kind: "login", user: "ana", from: "203.0.113.50" },
    { v: 1, at: ago(5), kind: "module", user: "rafael", text: "trust aprovado: x abc1234" },
  );
  jsonl("notes.jsonl", { v: 1, id: "n1", at: ago(3), ev: "add", author: "ana", text: "não reiniciar o asterisk \u001b[31mem horário", tags: ["aviso"] });
}

async function open(cols: number, rows: number) {
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(fixtures, "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" /> };
  const t = (h = await renderTui(<App root={root} logger={quiet()} onExit={() => {}} statePath={join(pvxHome(), "s.json")} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />, { cols, rows }));
  for (let i = 0; i < 12 && !t.frame().includes("› diário"); i++) await t.press("TAB");
  await t.press("ARROW_DOWN");
  return t;
}

for (const [cols, rows] of [[80, 24], [120, 40]] as const) {
  test(`the Diário tab renders ${cols}x${rows}: chips, day groups, rows and the detail, nothing overflows`, async () => {
    fixtureFiles();
    markSeen("me", Date.now() - 3.5 * 60000); // the last visit: only the entries after it are news
    const t = await open(cols, rows);
    const f = t.frame();
    const bar = f.split("\n")[0]!;
    for (const l of ["Início", "Módulos", "Diário"]) expect(bar).toContain(l);
    if (cols > 80) expect(bar).toMatch(/Diário\s+Logs\s+Comando/); // the trailing core group: Diário · Logs · Comando (80 columns scroll the bar)
    for (const w of ["tudo", "novidades", "notas", "comandos", "conformidade", "logins", "› diário", "firewall apply", "SSH de 203.0.113.50", "IP no Asterisk", "trust aprovado"]) expect(f).toContain(w);
    expect(f).toMatch(/hoje|ontem/);
    expect(f).toContain("novidades ●3"); // conf, cmd (carlos) and... the entries after the last visit by someone else
    expect(f).not.toContain("\u001b");
    expect(f).toContain("não reiniciar o asterisk em horário"); // ANSI in a note is inert text
    for (const l of f.split("\n")) expect([...l].length).toBeLessThanOrEqual(cols);
    expect(f.split("\n").filter((l) => l.trim()).at(-1)).toContain("n nota");
    expect(existsSync(join(pvxHome(), "seen", "me.json"))).toBe(true); // opening marks it seen
  });
}

const down = async (t: TuiHarness, n: number) => {
  for (let i = 0; i < n; i++) await t.press("ARROW_DOWN");
};

test("p on a conf entry goes to the Plano tab; on anything else it says why", async () => {
  fixtureFiles();
  const t = await open(120, 40);
  await t.press("p");
  await t.waitForFrame((f) => f.includes("› plano"));
  t.destroy();
  const u = await open(120, 40);
  await down(u, 1);
  await u.press("p");
  expect(u.frame()).toContain("só conformidade");
});

test("r puts a command entry's masked line in the Comando draft; on other entries it says why", async () => {
  fixtureFiles();
  const t = await open(120, 40);
  await t.press("r"); // the cursor is on the conf entry
  expect(t.frame()).toContain("só comandos repetem");
  await down(t, 1);
  await t.press("r");
  await t.waitForFrame((f) => f.includes("❯ firewall apply"));
});

test("n puts `nota add --ref <ref> ` in the Comando draft", async () => {
  fixtureFiles();
  const t = await open(120, 40);
  await down(t, 2); // the note
  await t.press("n");
  await t.waitForFrame((f) => f.includes("❯ nota add --ref nota:n1"));
});

test("chips filter by type; ←/→ move between them", async () => {
  fixtureFiles();
  const t = await open(120, 40);
  await t.press("ARROW_RIGHT"); // novidades
  await t.press("ARROW_RIGHT"); // notas
  expect(t.frame()).toContain("asterisk em horário");
  expect(t.frame()).not.toContain("firewall apply");
  await t.press("ARROW_RIGHT"); // comandos
  expect(t.frame()).toContain("firewall apply");
  expect(t.frame()).not.toContain("SSH de");
});

test("pure view: groups by day, filters, one detail per type", () => {
  const e = (kind: Kind, at: string, data: Record<string, unknown> = {}, text = "x"): DiaryEntry => ({ id: `${kind}|${at}`, kind, at, user: "u", text, ref: "r", data });
  const now = Date.parse("2026-10-09T12:00:00");
  const list = [e("cmd", "2026-10-09T11:00:00", { exit: 1, ms: 5 }), e("nota", "2026-10-08T10:00:00", { ev: "add" }), e("conf", "2026-10-06T10:00:00", { from: "ok", to: "error", cap: "c" })];
  expect(dayRows(list, now).map((r) => (r.type === "day" ? r.label : r.e.kind))).toEqual(["hoje", "cmd", "ontem", "nota", "06/10", "conf"]);
  expect(filterEntries(list, "comandos", new Set()).map((x) => x.kind)).toEqual(["cmd"]);
  expect(filterEntries(list, "novidades", new Set([list[1]!.id])).map((x) => x.kind)).toEqual(["nota"]);
  expect(detailLines(list[0]!, now).map((l) => l.text)).toContain("exit 1");
  expect(detailLines(list[2]!, now).map((l) => l.text)).toContain("ok -> error");
});

test("a host mutation run through the session (`act`) lands in the audit log; ignored items are not pending in Início", async () => {
  const store = createSessionStore({ registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history") });
  await store.act("modules remove x", async () => ({ exit: 0, lines: [] }));
  const { diary } = await import("@pvx/core");
  expect(diary.query({ kinds: ["cmd"] }).map((e) => e.text)).toEqual(["modules remove x"]);
  const lines = [
    { kind: "info" as const, text: "perfil: P" },
    { kind: "warning" as const, text: "a: pendente", fix: "x fix" },
    { kind: "info" as const, text: "b: pendente (ignorado até 10:00)", ignored: "2026-10-09T10:00:00Z" },
  ];
  const c = parseConformity({ at: 0, exit: 0, lines });
  expect(c.pending.map((p) => p.text)).toEqual(["a: pendente"]);
  expect(c.ignored).toEqual(["b: pendente (ignorado até 10:00)"]);
  expect(c.total).toBe(2);
});
