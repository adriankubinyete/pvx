import { expect, test } from "bun:test";
import { actionButtons, attentionRows, noteRows, planButtonLabel, truncate, upToDateText } from "../src/tabs/home-rows.ts";

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

test("the plan button counts the steps, and exists only with a plan page and steps to run", () => {
  expect(planButtonLabel(1)).toBe("rodar o plano (1 passo)");
  expect(planButtonLabel(3)).toBe("rodar o plano (3 passos)");
  expect(actionButtons(3, true, true).map((button) => button.label)).toEqual(["rodar o plano (3 passos)", "verificar de novo"]);
  expect(actionButtons(3, false, false).map((button) => button.label)).toEqual(["verificar"]);
  expect(actionButtons(0, true, true).map((button) => button.action)).toEqual(["verify"]);
});

test("the notes get a `+ nova nota` row only when a module can compose, and text is cut with an ellipsis", () => {
  expect(noteRows(["14/10 troca"], true).map((row) => row.id)).toEqual(["note:0", "nova"]);
  expect(noteRows([], false)).toEqual([]);
  expect(truncate("abcdef", 4)).toBe("abc…");
  expect(truncate("abc", 4)).toBe("abc");
});
