import { expect, test } from "bun:test";
import { coreColumns, decimalComma, heaviestLines, loadParts, machineLayout, memoryText, processesText, rateText, sizeText, sizeWidth, uptimeText } from "../src/tabs/home-view.ts";
import { glyphs } from "../src/theme.ts";

const GIB = 2 ** 30;
const MIB = 2 ** 20;

test("the size keeps its width as the use grows (small and big totals), with the comma of the language", () => {
  expect(sizeText(7.9 * GIB, 8 * GIB)).toBe("7,9/8G");
  expect(sizeText(2.7 * GIB, 4 * GIB)).toBe("2,7/4G");
  expect(sizeText(177 * GIB, 228 * GIB)).toBe("177/228G");
  expect(sizeText(5 * GIB, 44 * GIB)).toBe(" 5/44G");
  expect(sizeText(0, 0)).toBe("0,0/0G");
  for (const total of [1.9, 4, 9.5, 44, 228]) {
    const widths = [0, 0.05, 0.5, 1].map((share) => sizeText(share * total * GIB, total * GIB).length);
    expect(new Set(widths).size, `total ${total}`).toBe(1);
    expect(widths[0]).toBe(sizeWidth(total * GIB));
  }
});

test("the load, the rates, the uptime and the process counts are in fixed widths", () => {
  expect(decimalComma("1.8")).toBe("1,8");
  expect(loadParts([4, 3.9, 3.4])).toEqual({ first: "4,00", rest: "3,90 3,40" });
  expect(loadParts([12.34, 0.5, 0.05]).rest).toBe("0,50 0,05");
  expect(rateText({ iface: "eth0", rx: 384, tx: 321 }, glyphs.unicode)).toBe("↓   384 B/s   ↑   321 B/s ");
  expect(uptimeText((24 + 6) * 3600 + 42 * 60)).toBe("1d 6h 42m");
  expect(uptimeText(6 * 3600 + 5 * 60)).toBe("6h 5m");
  expect(uptimeText(90)).toBe("1m");
  expect(processesText(88, 1)).toBe("  88 ·   1 rodando");
  expect(processesText(88, undefined)).toBe("  88");
  for (const procs of [9, 88, 1234]) expect(processesText(procs, 1).length).toBe(processesText(1, 1).length + (procs > 9999 ? 1 : 0));
});

test("the heaviest processes are three lines: the name, the cpu share and the memory, each in a fixed width", () => {
  const lines = heaviestLines([{ name: "asterisk", pct: 3.1, mem: 55 * MIB }, { name: "fail2ban", pct: 2.4, mem: 43 * MIB }, { name: "php-fpm", pct: 1.2, mem: 1.2 * GIB }, { name: "cron", pct: 0.1 }]);
  expect(lines).toEqual(["asterisk    3,1%   55 MB", "fail2ban    2,4%   43 MB", "php-fpm     1,2%  1,2 GB"]);
  expect(heaviestLines(undefined)).toEqual([]);
  expect(memoryText(900)).toBe("   0 MB");
});

test("the cores fill the width first: as many columns as fit, rows = ceil(cores / columns), the bars stretching to the column", () => {
  expect(machineLayout(116, 1)).toMatchObject({ columns: 1, rows: 1, coreInner: 111 });
  expect(machineLayout(116, 2)).toMatchObject({ columns: 2, rows: 1 });
  expect(machineLayout(116, 8)).toMatchObject({ columns: 4, rows: 2 });
  expect(machineLayout(116, 12)).toMatchObject({ columns: 4, rows: 3 });
  expect(machineLayout(116, 32)).toMatchObject({ columns: 4, rows: 8 });
  expect(machineLayout(76, 12)).toMatchObject({ columns: 2, rows: 6 });
  expect(machineLayout(76, 1)).toMatchObject({ columns: 1, rows: 1 });
  expect(machineLayout(20, 12)).toMatchObject({ columns: 1, rows: 12 });
  expect(machineLayout(200, 12).columns).toBeGreaterThan(4);
  for (const width of [30, 76, 96, 116, 200]) {
    for (const cores of [1, 2, 8, 12, 32, 128]) {
      const layout = machineLayout(width, cores);
      expect(layout.columns * layout.rows, `${cores} at ${width}`).toBeGreaterThanOrEqual(cores);
      expect(layout.coreInner, `${cores} at ${width}`).toBeGreaterThan(0);
    }
  }
});

test("the facts sit on the right half when it holds them, else under the bars; the used bars take the left half", () => {
  expect(machineLayout(76, 8)).toMatchObject({ beside: true, usedInner: 31 });
  expect(machineLayout(116, 8)).toMatchObject({ beside: true, usedInner: 51 });
  expect(machineLayout(60, 8)).toMatchObject({ beside: false, usedInner: 55 });
});

test("the cores are laid out column by column", () => {
  const cores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(coreColumns(cores, 4).map((column) => column.map((core) => core.index))).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
  expect(coreColumns([], 4)).toEqual([]);
});
