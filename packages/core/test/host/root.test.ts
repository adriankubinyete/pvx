import { afterEach, expect, test } from "bun:test";
import { hostIsRoot } from "../../src/index.ts";

const saved = process.env.PVX_DEV;
afterEach(() => (saved === undefined ? delete process.env.PVX_DEV : (process.env.PVX_DEV = saved)));

test("PVX_DEV=1 makes the source a root; without it only uid 0 is (or Windows)", () => {
  const real = process.platform === "win32" || process.getuid?.() === 0;
  delete process.env.PVX_DEV;
  expect(hostIsRoot()).toBe(real);
  process.env.PVX_DEV = "1";
  expect(hostIsRoot()).toBe(true);
  process.env.PVX_DEV = "0";
  expect(hostIsRoot()).toBe(real);
});
