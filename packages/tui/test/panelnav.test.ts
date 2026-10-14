import { expect, test } from "bun:test";
import { pickPanel, panelStep, wrap, type Rect } from "../src/panelnav.ts";

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
// Início wide: máquina | conformidade over atividade.
const wide = { maquina: r(0, 0, 40, 10), conf: r(40, 0, 80, 10), ativ: r(0, 10, 120, 10) };
// Stacked: one column.
const stacked = { maquina: r(0, 0, 80, 8), conf: r(0, 8, 80, 8), ativ: r(0, 16, 80, 8) };

test("two columns: the arrows pick what is really on that side", () => {
  expect(pickPanel(wide, "conf", "left")).toBe("maquina");
  expect(pickPanel(wide, "conf", "down")).toBe("ativ");
  expect(pickPanel(wide, "ativ", "up")).toBe("conf"); // overlap prefers the nearer/larger overlap, then the gap
  expect(pickPanel(wide, "maquina", "right")).toBe("conf");
  expect(pickPanel(wide, "conf", "right")).toBeUndefined();
});

test("stacked: right and left find nothing; up and down walk the column", () => {
  expect(pickPanel(stacked, "conf", "right")).toBeUndefined();
  expect(pickPanel(stacked, "conf", "left")).toBeUndefined();
  expect(pickPanel(stacked, "conf", "down")).toBe("ativ");
  expect(pickPanel(stacked, "conf", "up")).toBe("maquina");
});

test("a non-navigable panel left out of the rects is skipped; the next one in that direction is found", () => {
  const row = { a: r(0, 0, 30, 10), mid: r(30, 0, 30, 10), c: r(60, 0, 30, 10) };
  expect(pickPanel(row, "a", "right")).toBe("mid");
  const { mid: _, ...without } = row;
  expect(pickPanel(without, "a", "right")).toBe("c");
});

test("no candidate, unknown current", () => {
  expect(pickPanel({ a: r(0, 0, 10, 10) }, "a", "down")).toBeUndefined();
  expect(pickPanel({}, "a", "down")).toBeUndefined();
});

test("two levels: arrows move panels, enter goes in only with items, esc comes out", () => {
  const pick = (p: string, d: "left" | "right" | "up" | "down") => pickPanel(wide, p, d);
  const size = (p: string) => (p === "maquina" ? 0 : 10);
  expect(panelStep({ panel: "conf", inside: false }, "down", pick, size)).toEqual({ panel: "ativ", inside: false });
  expect(panelStep({ panel: "conf", inside: false }, "up", pick, size)?.bar).toBe(true);
  expect(panelStep({ panel: "conf", inside: false }, "right", pick, size)?.nudge).toBe("nada aqui");
  expect(panelStep({ panel: "maquina", inside: false }, "enter", pick, size)?.nudge).toBe("nada para selecionar");
  expect(panelStep({ panel: "conf", inside: false }, "enter", pick, size)).toEqual({ panel: "conf", inside: true });
  expect(panelStep({ panel: "conf", inside: true }, "down", pick, size)?.move).toBe(1);
  expect(panelStep({ panel: "conf", inside: true }, "enter", pick, size)?.act).toBe(true);
  expect(panelStep({ panel: "conf", inside: true }, "esc", pick, size)).toEqual({ panel: "conf", inside: false });
  expect(panelStep({ panel: "conf", inside: false }, "esc", pick, size)).toBeUndefined();
});

test("wrap: both ends, a single row and an empty list", () => {
  expect(wrap(2, 1, 3)).toBe(0);
  expect(wrap(0, -1, 3)).toBe(2);
  expect(wrap(1, 1, 3)).toBe(2);
  expect(wrap(1, -1, 3)).toBe(0);
  expect(wrap(0, 1, 1)).toBe(0);
  expect(wrap(0, -1, 1)).toBe(0);
  expect(wrap(0, 1, 0)).toBe(0);
  expect(wrap(0, -1, 0)).toBe(0);
});
