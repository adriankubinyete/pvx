import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RGBA } from "@opentui/core";
import { auditCommand, createLogger, createRegistry, createStore, logsDir, phasesKey, pvxHome, runCapture, writeJobState, type Registry } from "@pvx/core";
import { expectButtonsReachable, expectNoKeyboardTrap, renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { App, createSessionStore, createTabsNav, Tabs, theme } from "../src/index.ts";
import { tokens } from "../src/theme.ts";

let h: TuiHarness | undefined;
let registry: Registry;
afterEach(() => h?.destroy());
beforeEach(() => {
  registry = createRegistry();
});

const makeLogger = (n: string) => createLogger(logsDir(), n);
/** One line of a log with the time given in local time of the day `day` (this month). */
function write(source: string, level: "DEBUG" | "INFO" | "WARN" | "ERROR", message: string, when: Date) {
  mkdirSync(logsDir(), { recursive: true });
  appendFileSync(join(logsDir(), `${source}.log`), `${when.toISOString()} ${level} ${source}: ${message}\n`);
}
const today = (hour: number, minute: number, second = 0) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, second);
};
/** Yesterday at the given time. */
const yesterday = (hour: number, minute: number, second = 0) => {
  const date = today(hour, minute, second);
  date.setDate(date.getDate() - 1);
  return date;
};

/** The logs of a busy central: a module warning, a job's lines, the host and an error from yesterday. */
function seed() {
  write("core", "INFO", "confiança aprovada (sempre): firewall 56d0ea8", today(11, 23, 29));
  write("issabel", "INFO", "netinstall concluído em 41 min · reinício adiado", today(12, 10, 2));
  write("autobackup", "WARN", "mysql-hora: sem espaço em /var/www/backup (precisa 2,1 GB, livre 0,8 GB)", today(13, 0, 41));
  write("firewall", "INFO", "IP 192.0.2.10 aceito (manual)", today(13, 30, 58));
  write("firewall", "INFO", "regras aplicadas: 40 · failsafe 198.51.100.7 · por operador", today(13, 31, 12));
  write("autobackup", "INFO", "issabel-noite: enviado 1,2 GB em 3 arquivos", yesterday(3, 31, 40));
  write("core", "ERROR", "módulo ssl não carregou: manifest inválido (campo pvx)", yesterday(22, 14, 51));
  write("firewall", "DEBUG", "leu as listas", today(13, 29, 0));
}

async function mount(opts: { cols?: number; rows?: number; copied?: string[] } = {}) {
  const store = createSessionStore({
    registry, makeLogger, isRoot: true, historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture({ env: {}, isRoot: true, registry, makeLogger, profilesDir: join(pvxHome(), "profiles"), version: "0.1.0", theme }, argv),
  });
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version="0.1.0" now={() => 1_700_000_000_000} logsMs={60} /> };
  const clipboard = async (text: string) => (opts.copied?.push(text), { ok: true as const });
  h = await renderTui(<App root={root} logger={makeLogger("core")} onExit={() => {}} statePath={join(pvxHome(), "s.json")} clipboard={clipboard} />, { cols: opts.cols, rows: opts.rows });
  for (let i = 0; i < 2; i++) await h.press("TAB"); // Início, Módulos, Logs
  await h.press("ARROW_DOWN");
  return { t: h, store };
}

const lines = (t: TuiHarness) => t.frame().split("\n");
const rowOf = (t: TuiHarness, text: string) => lines(t).slice(2).find((l) => l.includes(text));

test("ROOT CAUSE: the tab shows the logs of every module, not core.log alone", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  for (const s of ["issabel", "autobackup", "firewall", "pvx", "netinstall concluído", "mysql-hora: sem espaço", "regras aplicadas: 40"]) expect(t.frame(), s).toContain(s);
});

test("Logs at 120x40: the chips, the level, the search, ao vivo, the days, the time, the module column and the level word only for aviso and erro", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  const chips = lines(t)[2]!;
  expect(chips).toMatch(/ todos .* pvx .* autobackup .* firewall .* issabel .*nível.* info\+ .*\/ buscar.*● ao vivo/);
  const f = t.frame();
  expect(f).toContain("ontem");
  expect(f).toContain("hoje");
  expect(f.indexOf("ontem")).toBeLessThan(f.indexOf("hoje")); // oldest first: the end is the live end
  expect(rowOf(t, "regras aplicadas")).toMatch(/13:31:12\s+firewall\s+regras aplicadas/);
  expect(rowOf(t, "regras aplicadas")).not.toMatch(/aviso|erro|info/);
  expect(rowOf(t, "mysql-hora")).toMatch(/13:00:41\s+autobackup\s+aviso\s+mysql-hora/);
  expect(rowOf(t, "módulo ssl")).toMatch(/22:14:51\s+pvx\s+erro\s+módulo ssl/);
  expect(f).not.toContain("leu as listas"); // debug is below info+
  for (const l of lines(t)) expect(l.length).toBeLessThanOrEqual(120);
});

test("Logs at 80x24 fits the width and keeps the live end in view", async () => {
  seed();
  const { t } = await mount({ cols: 80, rows: 24 });
  for (const l of lines(t)) expect(l.length).toBeLessThanOrEqual(80);
  expect(t.frame()).toContain("● ao vivo");
  expect(t.frame()).toContain("regras aplicadas");
  expect(lines(t).at(-2)! + lines(t).at(-1)!).toContain("enter detalhes");
});

test("a warning word is in the warn color and an error in the error color", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  const spanOf = (word: string, line: string) => {
    const y = lines(t).findIndex((l) => l.includes(line));
    return t.spans().lines[y]!.spans.find((span) => span.text.includes(word))!;
  };
  expect(spanOf("aviso", "mysql-hora").fg.equals(RGBA.fromHex(tokens.warn))).toBe(true);
  expect(spanOf("erro", "módulo ssl").fg.equals(RGBA.fromHex(tokens.error))).toBe(true);
  expect(spanOf("autobackup", "mysql-hora").fg.equals(RGBA.fromHex(tokens.accent))).toBe(true);
});

test("← and → filter by source, n steps the level, and debug shows from debug+", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("ARROW_RIGHT"); // pvx
  expect(t.frame()).toContain("módulo ssl");
  expect(t.frame()).not.toContain("regras aplicadas");
  await t.press("ARROW_RIGHT"); // autobackup
  expect(t.frame()).toContain("mysql-hora");
  expect(t.frame()).not.toContain("módulo ssl");
  await t.press("ARROW_LEFT");
  await t.press("ARROW_LEFT"); // todos
  expect(t.frame()).toContain("regras aplicadas");
  await t.press("n"); // aviso+
  expect(lines(t)[2]).toContain(" aviso+ ");
  expect(t.frame()).toContain("mysql-hora");
  expect(t.frame()).not.toContain("regras aplicadas");
  await t.press("n"); // erro
  expect(t.frame()).not.toContain("mysql-hora");
  expect(t.frame()).toContain("módulo ssl");
  await t.press("n"); // debug+
  expect(t.frame()).toContain("leu as listas");
  await t.press("n"); // info+
  expect(t.frame()).not.toContain("leu as listas");
});

test("/ opens the search: typing and pasting filter, enter keeps it, esc clears it", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("/");
  await t.type("sem espaço");
  expect(t.frame()).toContain("mysql-hora");
  expect(t.frame()).not.toContain("regras aplicadas");
  await t.press("RETURN");
  expect(lines(t)[2]).toContain("/ sem espaço");
  expect(t.frame()).not.toContain("regras aplicadas"); // kept
  await t.press("ESCAPE"); // clears the filter, stays on the tab
  expect(t.frame()).toContain("regras aplicadas");
  expect(lines(t)[2]).toContain("/ buscar");
  await t.press("/");
  await t.paste("failsafe");
  expect(t.frame()).toContain("regras aplicadas");
  expect(t.frame()).not.toContain("mysql-hora");
  await t.press("ESCAPE");
  expect(t.frame()).toContain("mysql-hora");
});

test("↑ leaves the live end (pausado) and end comes back; the cursor starts on the newest line", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  expect(rowOf(t, "regras aplicadas")).toContain("»");
  await t.press("ARROW_UP");
  expect(t.frame()).toContain("○ pausado");
  expect(rowOf(t, "IP 192.0.2.10 aceito")).toContain("»");
  await t.press("HOME");
  expect(rowOf(t, "enviado 1,2 GB")).toContain("»"); // the oldest line
  await t.press("END");
  expect(t.frame()).toContain("● ao vivo");
  expect(rowOf(t, "regras aplicadas")).toContain("»");
});

test("new log lines appear by themselves while live, and the tab stops reading when left", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).not.toContain("linha nova do módulo");
  write("firewall", "INFO", "linha nova do módulo", new Date());
  for (let i = 0; i < 30 && !t.frame().includes("linha nova do módulo"); i++) (await Bun.sleep(40), await t.flush());
  expect(t.frame()).toContain("linha nova do módulo");
  expect(rowOf(t, "linha nova do módulo")).toContain("»"); // live: the cursor is on the newest
});

test("enter opens the details under the line and enter again closes them; the lines that continue a message show on the current line", async () => {
  seed();
  appendFileSync(join(logsDir(), "firewall.log"), `${today(13, 32, 0).toISOString()} ERROR firewall: falhou ao aplicar\n\tstack linha 1\n\tstack linha 2\n`);
  const { t } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).toContain("stack linha 1");
  expect(t.frame()).toContain("stack linha 2");
  await t.press("RETURN");
  expect(t.frame()).toContain("fonte  firewall");
  expect(t.frame()).toContain("nível  erro");
  expect(t.frame()).toMatch(/hora {3}\d{4}-\d\d-\d\d 13:32:00/);
  expect(t.frame()).toContain("texto  falhou ao aplicar");
  await t.press("RETURN");
  expect(t.frame()).not.toContain("fonte  firewall");
});

/** A job of autobackup in the dump phase at 13:00, with the line it wrote to the module log. */
function seedJob() {
  const start = today(13, 0, 0).getTime();
  writeJobState("autobackup", "backup-mysql-hora", { state: "failed", startedAt: start, endedAt: start + 5000, line: "run mysql" });
  createStore("autobackup").set(phasesKey("backup-mysql-hora"), {
    startedAt: start, runStartedAt: start,
    phases: [{ id: "dump", label: "dump", weight: 1, state: "failed", startedAt: start, endedAt: start + 4000 }, { id: "upload", label: "enviar", weight: 1, state: "pending" }],
  });
  write("autobackup", "WARN", "[job backup-mysql-hora] sem espaço em /var/www/backup", new Date(start + 1000));
  return { start };
}

test("a line of a job says its phase and task, and enter shows the log of the task in the Comando", async () => {
  seed();
  seedJob();
  const { t, store } = await mount({ cols: 120, rows: 40 });
  await t.press("end");
  const job = lines(t).findIndex((l) => l.includes("[job backup-mysql-hora] sem espaço"));
  expect(job).toBeGreaterThan(-1);
  for (let i = 0; i < 12 && !lines(t)[job]!.includes("»"); i++) await t.press("ARROW_UP");
  expect(lines(t)[job]).toContain("»");
  expect(lines(t)[job + 1]).toContain("↳ fase dump · tarefa backup-mysql-hora · enter mostra o log da tarefa");
  await t.press("RETURN");
  await Bun.sleep(200);
  await t.flush();
  expect(store.blocks.map((b) => b.line)).toEqual(["jobs log autobackup backup-mysql-hora"]);
  expect(t.frame()).toContain("tab completa"); // the Comando
});

test("c copies the line as the file has it", async () => {
  seed();
  const copied: string[] = [];
  const { t } = await mount({ cols: 120, rows: 40, copied });
  await t.press("c");
  await t.flush();
  expect(copied).toHaveLength(1);
  expect(copied[0]).toMatch(/^\S+ INFO firewall: regras aplicadas: 40/);
});

test("a toggles to the audit trail and back; the chips become the audit one", async () => {
  seed();
  process.env.PVX_AUDIT = "all";
  auditCommand({ line: "firewall apply", exit: 0, ms: 5, destructive: false });
  auditCommand({ line: "backup run", exit: 1, ms: 5, destructive: true });
  const { t } = await mount({ cols: 120, rows: 40 });
  await t.press("a");
  expect(lines(t)[2]).toMatch(/ audit /);
  expect(lines(t)[2]).not.toContain("firewall ");
  expect(t.frame()).toContain(": firewall apply");
  expect(rowOf(t, "backup run")).toMatch(/audit\s+aviso\s+.*backup run · saiu 1/);
  expect(t.frame()).not.toContain("netinstall");
  await t.press("a");
  expect(t.frame()).toContain("netinstall");
  delete process.env.PVX_AUDIT;
});

test("with no logs the tab says so; a filter with no match says that", async () => {
  const { t } = await mount({ cols: 120, rows: 40 });
  expect(t.frame()).toContain("sem registros");
  t.destroy();
  seed();
  const m = await mount({ cols: 120, rows: 40 });
  await m.t.press("/");
  await m.t.type("zzzz");
  expect(m.t.frame()).toContain("nada com este filtro");
});

test("Logs keeps the keyboard free: esc reaches the bar, even from the search, and every button is reachable", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  expectButtonsReachable();
  await expectNoKeyboardTrap(t);
  await t.press("ARROW_DOWN");
  await t.press("/");
  await expectNoKeyboardTrap(t);
});

test("mouse: a click on a source chip filters, a click on a line selects it and pauses, a click on ao vivo resumes", async () => {
  seed();
  const { t } = await mount({ cols: 120, rows: 40 });
  const chips = lines(t)[2]!;
  await t.click(chips.indexOf("autobackup") + 2, 2);
  expect(t.frame()).toContain("mysql-hora");
  expect(t.frame()).not.toContain("regras aplicadas");
  await t.click(chips.indexOf(" todos ") + 2, 2);
  const y = lines(t).findIndex((l) => l.includes("IP 192.0.2.10 aceito"));
  await t.click(30, y);
  expect(lines(t)[y]).toContain("»");
  expect(t.frame()).toContain("○ pausado");
  await t.click(lines(t)[2]!.indexOf("○ pausado") + 2, 2);
  expect(t.frame()).toContain("● ao vivo");
});
