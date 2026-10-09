import { expect, test } from "bun:test";
import { readMachine } from "../../src/index.ts";

test("readMachine returns sane numbers", () => {
  const m = readMachine();
  expect(m.load).toBeGreaterThanOrEqual(0);
  expect(m.cpus).toBeGreaterThan(0);
  for (const p of [m.ramPct, m.diskPct]) expect(p).toBeGreaterThanOrEqual(0), expect(p).toBeLessThanOrEqual(100);
  expect(m.diskPct).toBeGreaterThan(0);
  expect(m.uptime).toBeGreaterThan(0);
});
