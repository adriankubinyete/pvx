import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditCommand, auditJob, createLogger, jobOfEntry, logsDir, parseLogEntry, pvxHome, readAuditEntries, readLogEntries } from "../../src/index.ts";

test("an entry is its time, level, source and message; continuation lines are its detail", () => {
  const entry = parseLogEntry("2026-10-15T13:39:04.123Z WARN firewall: regras aplicadas: 40\n\tpasso 1\n\tpasso 2")!;
  expect(entry).toMatchObject({ at: Date.parse("2026-10-15T13:39:04.123Z"), level: "warn", source: "firewall", message: "regras aplicadas: 40", detail: ["passo 1", "passo 2"] });
  expect(parseLogEntry("lixo sem formato")).toBeUndefined();
  expect(parseLogEntry("nao-e-data INFO core: x")).toBeUndefined();
});

test("ROOT CAUSE of the empty Logs tab: the entries of every module and of the core are read together, in time order", () => {
  // `pvx logs` with no argument reads core.log alone: the tab showed one line while the modules had written plenty.
  createLogger(logsDir(), "core").info("pvx iniciado");
  createLogger(logsDir(), "firewall").warn("regra não aplicada");
  createLogger(logsDir(), "autobackup").error("backup falhou");
  const entries = readLogEntries(logsDir());
  expect(entries.map((e) => `${e.source}:${e.level}`).sort()).toEqual(["autobackup:error", "core:info", "firewall:warn"]);
  expect(entries.map((e) => e.at)).toEqual([...entries.map((e) => e.at)].sort((a, b) => a - b));
  expect(readLogEntries(logsDir(), 2)).toHaveLength(2); // the newest `tail`
});

test("rotated files are read too, and an unreadable dir is no entries", () => {
  mkdirSync(logsDir(), { recursive: true });
  writeFileSync(join(logsDir(), "velho.log.1"), "2026-10-14T10:00:00.000Z INFO velho: de ontem\n");
  writeFileSync(join(logsDir(), "velho.log"), "2026-10-15T10:00:00.000Z INFO velho: de hoje\n");
  expect(readLogEntries(logsDir()).map((e) => e.message)).toEqual(["de ontem", "de hoje"]);
  expect(readLogEntries(join(pvxHome(), "nao-existe"))).toEqual([]);
});

test("the audit trail is one more log, oldest first; a failed command is a warning", () => {
  process.env.PVX_AUDIT = "all";
  auditCommand({ line: "firewall apply", exit: 0, ms: 5, destructive: false });
  auditCommand({ line: "backup run", exit: 1, ms: 5, destructive: true });
  auditJob("start autobackup/noite: autobackup run noite");
  const entries = readAuditEntries();
  expect(entries.map((e) => [e.source, e.level])).toEqual([["audit", "info"], ["audit", "warn"], ["audit", "info"]]);
  expect(entries[1]!.message).toContain("backup run · saiu 1");
  expect(entries[2]!.message).toContain("start autobackup/noite");
  delete process.env.PVX_AUDIT;
});

test("a line of a job is known by its module log and by the host's start and stop in the core log", () => {
  expect(jobOfEntry({ source: "autobackup", message: "[job noite] enviado 1,2 GB" })).toEqual({ module: "autobackup", name: "noite" });
  expect(jobOfEntry({ source: "autobackup", message: "job noite iniciado: run" })).toEqual({ module: "autobackup", name: "noite" });
  expect(jobOfEntry({ source: "core", message: "job autobackup: job noite iniciado: run" })).toEqual({ module: "autobackup", name: "noite" });
  expect(jobOfEntry({ source: "core", message: "pvx iniciado" })).toBeUndefined();
  expect(jobOfEntry({ source: "autobackup", message: "rotina salva" })).toBeUndefined();
});
