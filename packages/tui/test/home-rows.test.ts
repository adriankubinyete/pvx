import { expect, test } from "bun:test";
import { attentionRows, noteRows, truncate, upToDateText } from "../src/tabs/home-rows.ts";

test("an attention row has a button only when it has a fix, and a broken widget is a warning row", () => {
  const rows = attentionRows([{ level: "warn", title: "Firewall desatualizado", fix: "firewall apply" }, { level: "error", title: "Backup falhou" }], ["w.boom"]);
  expect(rows.map((row) => [row.id, row.level, row.button, row.use])).toEqual([
    ["Firewall desatualizado", "warn", "corrigir", "firewall apply"],
    ["Backup falhou", "error", undefined, undefined],
    ["broken:w.boom", "warn", undefined, undefined],
  ]);
});

test("the up to date line counts in the singular and plural, and says nothing at zero", () => {
  expect(upToDateText(0)).toBeUndefined();
  expect(upToDateText(1)).toBe("1 capacidade em dia");
  expect(upToDateText(6)).toBe("6 capacidades em dia");
});

test("the notes are `dd/mm  texto  — assinatura` rows in the order given, each with the command that removes it, and `+ nova nota` only when something can write one", () => {
  const notes = [
    { n: 3, at: "2026-10-16T10:00:00", text: "troca do tronco\nconcluída", signature: "Ana" },
    { n: 1, at: "2026-10-02T10:00:00", text: "sem assinatura" },
  ];
  const rows = noteRows(notes, true, "nota remove");
  expect(rows.map((row) => [row.id, row.text, row.remove])).toEqual([
    ["note:3", "16/10  troca do tronco concluída  — Ana", "nota remove 3"],
    ["note:1", "02/10  sem assinatura", "nota remove 1"],
    ["nova", "+ nova nota", undefined],
  ]);
  expect(noteRows(notes, false).map((row) => row.id)).toEqual(["note:3", "note:1"]);
  expect(noteRows([], false)).toEqual([]);
  expect(truncate("abcdef", 4)).toBe("abc…");
  expect(truncate("abc", 4)).toBe("abc");
});
