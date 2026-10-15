import { expect, test } from "bun:test";
import type { LogEntry } from "@pvx/core";
import { ALL_SOURCES, dayLabel, detailLines, filterEntries, groupByDay, jobHint, levelChipLabel, nextLevel, phaseAt, sourceChips, stepSource, timeText, withIds } from "../src/tabs/logs-view.ts";

/** 2026-10-15 13:39 local. */
const NOW = new Date(2026, 9, 15, 13, 39).getTime();
const at = (day: number, hour: number, minute: number, second = 0) => new Date(2026, 9, day, hour, minute, second).getTime();
const entry = (source: string, level: LogEntry["level"], message: string, when = NOW, detail: string[] = []): LogEntry => ({ at: when, level, source, message, detail, raw: `${when} ${message}` });

test("the filters keep the chosen source, the level and above, and what matches the search (case and accents aside)", () => {
  const all = [
    entry("core", "info", "pvx iniciado"),
    entry("firewall", "debug", "leu as listas"),
    entry("firewall", "warn", "regra não aplicada"),
    entry("autobackup", "error", "backup falhou"),
  ];
  const keep = (source: string, level: LogEntry["level"], search = "") => filterEntries(all, { source, level, search }).map((e) => e.message);
  expect(keep(ALL_SOURCES, "info")).toEqual(["pvx iniciado", "regra não aplicada", "backup falhou"]);
  expect(keep(ALL_SOURCES, "debug")).toHaveLength(4);
  expect(keep(ALL_SOURCES, "warn")).toEqual(["regra não aplicada", "backup falhou"]);
  expect(keep(ALL_SOURCES, "error")).toEqual(["backup falhou"]);
  expect(keep("firewall", "debug")).toEqual(["leu as listas", "regra não aplicada"]);
  expect(keep(ALL_SOURCES, "info", "NAO aplic")).toEqual(["regra não aplicada"]);
  expect(keep(ALL_SOURCES, "info", "pvx")).toEqual(["pvx iniciado"]); // the host is read as `pvx`
  expect(keep(ALL_SOURCES, "info", "zzz")).toEqual([]);
});

test("the source chips are todos, the host, then the modules that wrote or are loaded, sorted; a gone source starts over", () => {
  const entries = [entry("firewall", "info", "a"), entry("core", "info", "b"), entry("audit", "info", "c")];
  const chips = sourceChips(entries, ["issabel", "firewall"]);
  expect(chips).toEqual(["todos", "core", "firewall", "issabel"]);
  expect(stepSource(chips, "todos", 1)).toBe("core");
  expect(stepSource(chips, "todos", -1)).toBe("issabel");
  expect(stepSource(chips, "issabel", 1)).toBe("todos");
  expect(stepSource(chips, "sumiu", 1)).toBe("core");
});

test("the level chip cycles and names itself", () => {
  expect([levelChipLabel("debug"), levelChipLabel("info"), levelChipLabel("warn"), levelChipLabel("error")]).toEqual(["debug+", "info+", "aviso+", "erro"]);
  expect(nextLevel("info")).toBe("warn");
  expect(nextLevel("error")).toBe("debug");
});

test("the days are hoje, ontem, the date, and the date with the year for another year; the time is local HH:MM:SS", () => {
  expect(dayLabel(at(15, 1, 0), NOW)).toBe("hoje");
  expect(dayLabel(at(14, 23, 59), NOW)).toBe("ontem");
  expect(dayLabel(at(10, 8, 0), NOW)).toBe("10/10");
  expect(dayLabel(new Date(2025, 11, 31).getTime(), NOW)).toBe("31/12/2025");
  expect(timeText(at(15, 3, 5, 9))).toBe("03:05:09");
});

test("the lines come in order with a heading before the first of each day", () => {
  const lines = withIds([entry("core", "info", "a", at(14, 22, 14)), entry("core", "info", "b", at(15, 3, 30)), entry("core", "info", "c", at(15, 13, 0))]);
  expect(groupByDay(lines, NOW).map((row) => (row.kind === "day" ? row.label : row.line.entry.message))).toEqual(["ontem", "a", "hoje", "b", "c"]);
});

test("two entries of one source in the same millisecond have different ids, stable between reads", () => {
  const twice = [entry("core", "info", "a"), entry("core", "info", "b")];
  const ids = withIds(twice).map((line) => line.id);
  expect(new Set(ids).size).toBe(2);
  expect(withIds(twice).map((line) => line.id)).toEqual(ids);
});

test("the phase of a job at a time is the one that had started and not ended; the hint names it", () => {
  const task = { phases: { phases: [{ label: "dump", startedAt: 100, endedAt: 200 }, { label: "enviar", startedAt: 200 }] } };
  expect(phaseAt(task, 150)).toBe("dump");
  expect(phaseAt(task, 5000)).toBe("enviar");
  expect(phaseAt(task, 50)).toBeUndefined();
  expect(phaseAt({}, 150)).toBeUndefined();
  expect(jobHint("backup-mysql-hora", "dump")).toBe("↳ fase dump · tarefa backup-mysql-hora · enter mostra o log da tarefa");
  expect(jobHint("backup-mysql-hora", undefined)).toBe("↳ tarefa backup-mysql-hora · enter mostra o log da tarefa");
});

test("the details are the source, the level, the whole time, the whole text and the lines that continue it", () => {
  expect(detailLines(entry("core", "warn", "algo", at(15, 13, 0, 4), ["passo 1"]))).toEqual(["fonte  pvx", "nível  aviso", "hora   2026-10-15 13:00:04", "texto  algo", "       passo 1"]);
});
