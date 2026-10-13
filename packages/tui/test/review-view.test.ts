import { expect, test } from "bun:test";
import { deliverySegs, fileRows, fmtWhen, hitGroups, linesText, repoOf, rulerMarks } from "../src/modules/review-view.ts";

test("fmtWhen: local date and time, with hoje and ontem", () => {
  const now = new Date(2026, 9, 13, 15, 0);
  expect(fmtWhen(new Date(2026, 9, 13, 9, 5).toISOString(), now)).toBe("13/10/2026 09:05 (hoje)");
  expect(fmtWhen(new Date(2026, 9, 12, 23, 59).toISOString(), now)).toBe("12/10/2026 23:59 (ontem)");
  expect(fmtWhen(new Date(2026, 9, 1, 8, 0).toISOString(), now)).toBe("01/10/2026 08:00");
});

test("repoOf: owner/repo from https, scp and file URLs", () => {
  expect(repoOf("https://github.com/acme/sr.git")).toBe("acme/sr");
  expect(repoOf("git@github.com:acme/sr.git")).toBe("acme/sr");
  expect(repoOf("file://C:\\tmp\\x\\rv.git")).toBe("x/rv");
  expect(repoOf(undefined)).toBe("(local)");
});

test("linesText and rulerMarks", () => {
  expect(linesText([38])).toBe("linha 38");
  expect(linesText([38, 40, 55])).toBe("linhas 38, 40 e 55");
  expect(linesText([1, 2, 3, 4, 5, 6, 7, 8])).toBe("linhas 1, 2, 3, 4, 5, 6 e mais 2");
  const m = rulerMarks(100, [1, 50, 100], 10);
  expect(m.map((x) => (x ? "●" : "─")).join("")).toBe("●───●────●");
  expect(rulerMarks(1, [1], 5)[0]).toBe(true);
});

test("hitGroups groups by message; fileRows adds one header per group", () => {
  expect(hitGroups([{ line: 3, msg: "a" }, { line: 1, msg: "b" }, { line: 1, msg: "a" }])).toEqual([{ msg: "a", lines: [1, 3] }, { msg: "b", lines: [1] }]);
  const f = (path: string, group: string, lines: number, hits = 0) => ({ path, group, lines, entry: false, used: true, importedBy: [], hits: Array.from({ length: hits }, (_, i) => ({ line: i + 1, msg: "m" })) });
  const rows = fileRows([f("index.ts", ".", 4), f("lib/a.ts", "lib/", 10, 2), f("lib/b.ts", "lib/", 5)]);
  expect(rows.map((r) => (r.kind === "head" ? `${r.group} ${r.count}/${r.lines}/${r.hits}` : r.name))).toEqual([". 1/4/0", "index.ts", "lib/ 2/15/2", "a.ts", "b.ts"]);
});

test("deliverySegs leaves out empty parts and colors the counts", () => {
  const text = (s: ReturnType<typeof deliverySegs>) => s.map((x) => x[0]).join("");
  expect(text(deliverySegs({ total: 13, groups: [{ name: "ip", count: 6 }, { name: "port", count: 4 }], singles: ["a", "b", "c"] }, 2, 1))).toBe("13 comandos (ip 6 · port 4 · +3 avulsos) · 2 páginas · 1 widget");
  expect(text(deliverySegs({ total: 0, groups: [], singles: [] }, 1, 0))).toBe("1 página");
  expect(deliverySegs({ total: 0, groups: [], singles: [] }, 0, 0)).toEqual([]);
  expect(deliverySegs({ total: 1, groups: [], singles: ["hi"] }, 0, 0)[0]).toEqual(["1", "info"]);
});
