import { expect, test } from "bun:test";
import { coreGrid, coreRows, coresText, decimalComma, loadText, machineHeadline, rateText, usedOfText, usedOfWidth } from "../src/tabs/home-view.ts";
import { glyphs } from "../src/theme.ts";
import { snap } from "./machine-fixture.ts";

const GIB = 2 ** 30;

test("`x de y GB` keeps its width as the use grows (small and big totals)", () => {
  expect(usedOfText(2.7 * GIB, 4 * GIB)).toBe("2,7 de 4 GB");
  expect(usedOfText(0.2 * GIB, 2 * GIB)).toBe("0,2 de 2 GB");
  expect(usedOfText(18 * GIB, 44 * GIB)).toBe("18 de 44 GB");
  expect(usedOfText(5 * GIB, 44 * GIB)).toBe(" 5 de 44 GB");
  for (const total of [1.9, 4, 9.5, 44, 228]) {
    const widths = [0, 0.05, 0.5, 1].map((share) => usedOfText(share * total * GIB, total * GIB).length);
    expect(new Set(widths).size, `total ${total}`).toBe(1);
    expect(widths[0]).toBe(usedOfWidth(total * GIB));
  }
});

test("the load, the rates and the decimals use the comma of the technician's language", () => {
  expect(decimalComma("1.8")).toBe("1,8");
  expect(loadText([1.8, 12.34, 0.05])).toBe(" 1,8 12,3  0,1");
  expect(rateText({ iface: "eth0", rx: 2.1 * 1048576, tx: 340 * 1024 }, glyphs.unicode)).toBe("↓   2,1 MB/s  ↑   340 KB/s");
  expect(coresText(1)).toBe("1 núcleo");
  expect(coresText(8)).toBe("8 núcleos");
});

test("the headline is one row when it fits, two when it does not, and says the session only when there is one", () => {
  const machine = snap(8, { host: "central-01", os: "Rocky Linux 8.10", uptime: (3 * 24 + 4) * 3600 });
  const wide = machineHeadline(machine, "Issabel 5", "198.51.100.7", 100);
  expect(wide).toMatchObject({ details: "Rocky Linux 8.10 · Issabel 5 · ligado há 3d 4h · sessão ", sessionIp: "198.51.100.7", oneRow: true });
  expect(machineHeadline(machine, "Issabel 5", "198.51.100.7", 60).oneRow).toBe(false);
  expect(machineHeadline(machine, undefined, undefined, 100)).toMatchObject({ details: "Rocky Linux 8.10 · ligado há 3d 4h", sessionIp: undefined });
});

test("four cores per row; eight from a wide terminal when there are many; the cells always fit", () => {
  for (const cores of [1, 2, 4, 8, 16, 32, 64, 256]) {
    for (const width of [67, 91, 111, 200]) {
      const grid = coreGrid(cores, width);
      const cell = grid.idxWidth + 1 + grid.barWidth + 4;
      const rowWidth = grid.perRow * cell + (grid.perRow - 1) * grid.gap;
      if (cores <= 8) expect(grid.perRow).toBe(4);
      expect(rowWidth, `${cores} cores, ${width}`).toBeLessThanOrEqual(width);
    }
  }
  expect(coreGrid(64, 107).perRow).toBe(8);
  expect(coreGrid(64, 67).perRow).toBe(4);
  expect(coreRows([1, 2, 3, 4, 5, 6], 4).map((row) => row.map((core) => core.index))).toEqual([[0, 1, 2, 3], [4, 5]]);
  expect(coreRows([], 4)).toEqual([]);
});
