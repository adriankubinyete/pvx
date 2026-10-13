import { expect, test } from "bun:test";
import { glyphs } from "../src/theme.ts";
import { snap } from "./machine-fixture.ts";
import { graph, machineCard, planCard, type Line } from "../src/tabs/machine-card.ts";

const text = (l: Line) => l.map((s) => s[0]).join("");

test("braille graph: two values per cell, four dot levels, stretched to the width", () => {
  expect(graph([0, 100], 1, 1, glyphs.unicode)).toEqual(["⣸"]); // baseline left, full right
  expect(graph([100, 100], 1, 1, glyphs.unicode)).toEqual(["⣿"]);
  expect(graph([], 3, 1, glyphs.unicode)).toEqual(["⣀⣀⣀"]);
  expect(graph([0, 100], 6, 1, glyphs.unicode)[0]).toHaveLength(6);
  expect(graph([100, 100], 1, 2, glyphs.unicode)).toEqual(["⣿", "⣿"]);
  expect(graph([50, 50], 1, 2, glyphs.unicode)).toEqual([" ", "⣿"]); // 50% of 2 rows: the bottom one full
});

test("block fallback: one character per cell, from the glyph table (also ASCII)", () => {
  expect(graph([0, 50, 100], 3, 1, { ...glyphs.unicode, braille: "" })).toEqual(["▁▄█"]);
  expect(graph([0, 100], 2, 1, glyphs.ascii)).toEqual(["_#"]);
  expect(graph([100], 1, 2, glyphs.ascii)).toEqual(["#", "#"]);
});

test("every row of the card fills the inner width exactly, at any width and core count", () => {
  for (const w of [50, 54, 74, 96, 222])
    for (const n of [1, 8, 16, 17, 64])
      for (const max of [0, 12, 16, 99]) for (const g of [glyphs.unicode, glyphs.ascii])
        for (const l of machineCard(snap(n), w, max, g)) expect(text(l)).toHaveLength(w);
});

test("the 54-wide card has the mockup's sections, two columns up to 16 cores and four above with no % label", () => {
  const t = machineCard(snap(8), 54, 99, glyphs.unicode).map(text);
  expect(t).toHaveLength(15);
  expect(t[0]).toContain("central-sp-01");
  expect(t[0]).toContain("Rocky 8.10 · up 41d");
  expect(t[1]).toMatch(/^─ cpu ─+$/);
  expect(t[2]).toMatch(/ 39% · carga 2.14 1.80 1.32$/);
  expect(t[3]).toMatch(/^0 ▰*▱+ +0%  +4 ▰/); // two columns, filled column by column
  expect(t.filter((x) => x.includes("%") && /^\d /.test(x))).toHaveLength(4);
  expect(t[7]).toMatch(/^─ memória · disco ─+$/);
  expect(t[8]).toMatch(/^mem {3}▰+▱+ +52% +3\.1\/6\.0G$/);
  expect(t[9]).toMatch(/^swap {2}▱+ +0% +0\/2\.0G$/);
  expect(t[10]).toMatch(/^disco ▰+▱+ +70% +38\/54G$/);
  expect(t[11]).toMatch(/^─ rede · processos ─+$/);
  expect(t[12]).toMatch(/^eth0 {2}↓ 1\.2 MB\/s {2}↑ 340 KB\/s {2}212 proc +$/);
  expect(t[13]).toMatch(/^asterisk 68% {2}mysqld 12% {2}httpd 4% +$/);
  expect(t[14]).toMatch(/ {2}atualizado 14:32:07$/);

  const many = machineCard(snap(32), 54, 99, glyphs.unicode).map(text);
  const cores = many.filter((x) => /^ ?\d/.test(x));
  expect(cores).toHaveLength(8); // 32 cores in 4 columns
  expect(cores.join("")).not.toContain("%");
  expect(cores[0]).toMatch(/^ 0 ▰*▱* {2} 8 /);
});

test("unavailable data reads n/d", () => {
  const t = machineCard(snap(2, { swap: undefined, disk: undefined, net: undefined, procs: undefined, top: undefined }), 54, 99, glyphs.unicode).map(text);
  expect(t.some((x) => /^swap +n\/d/.test(x))).toBe(true);
  expect(t.some((x) => /^disco +n\/d/.test(x))).toBe(true);
  expect(t.some((x) => x.startsWith("rede n/d"))).toBe(true);
  expect(t.some((x) => x.startsWith("processos n/d"))).toBe(true);
});

test("rows drop by priority: processes, network, second graph row, swap; cores, memory and disk stay", () => {
  const rows = (n: number, w: number, max: number) => machineCard(snap(n), w, max, glyphs.unicode).map(text);
  const has = (t: string[], s: string) => t.some((x) => x.includes(s));
  expect(rows(8, 54, 15)).toHaveLength(15);
  let t = rows(8, 54, 14);
  expect(has(t, "asterisk")).toBe(false);
  expect(has(t, "eth0")).toBe(true);
  t = rows(8, 54, 12);
  expect(has(t, "eth0") || has(t, "rede")).toBe(false);
  expect(has(t, "swap")).toBe(true);
  t = rows(8, 54, 11);
  expect(has(t, "swap")).toBe(false);
  for (const x of ["mem ", "disco ", "atualizado"]) expect(has(t, x)).toBe(true);
  expect(t.filter((x) => /^\d /.test(x))).toHaveLength(4);
  expect(t).toHaveLength(11);
  // wide: the second graph row goes after the network, before swap
  expect(planCard(8, 96, 99)).toMatchObject({ graph2: true, rows: 16 });
  expect(planCard(8, 96, 15)).toMatchObject({ graph2: true, net: true, procs: false });
  expect(planCard(8, 96, 14)).toMatchObject({ graph2: true, net: false, swap: true });
  expect(planCard(8, 96, 12)).toMatchObject({ graph2: false, swap: true });
  expect(planCard(8, 96, 11)).toMatchObject({ graph2: false, swap: false });
  expect(rows(8, 96, 99).filter((x) => x.includes("asterisk"))[0]).toContain("cron 1%"); // five processes when wide
});
