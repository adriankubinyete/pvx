import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cronKit } from "../../src/index.ts";

const { next } = cronKit;
const originalZone = process.env.TZ;

/** A local time as `YYYY-MM-DD HH:MM`, so a test reads the answer without time zones in the way. */
const show = (date: Date | undefined): string | undefined => {
  if (!date) return undefined;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
/** The next run of `expression` after the local time `year-month-day hour:minute:second` (month 1-12). */
const nextAfter = (expression: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  show(next(expression, new Date(year, month - 1, day, hour, minute, second)));

beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

describe("sdk.cron.next", () => {
  test("minutes and hours: the next one strictly after `from`", () => {
    expect(nextAfter("30 3 * * *", 2026, 3, 10, 1, 0)).toBe("2026-03-10 03:30");
    expect(nextAfter("30 3 * * *", 2026, 3, 10, 3, 29, 59)).toBe("2026-03-10 03:30");
    expect(nextAfter("30 3 * * *", 2026, 3, 10, 3, 30, 0)).toBe("2026-03-11 03:30");
    expect(nextAfter("30 3 * * *", 2026, 3, 10, 3, 30, 1)).toBe("2026-03-11 03:30");
    expect(nextAfter("* * * * *", 2026, 3, 10, 23, 59, 30)).toBe("2026-03-11 00:00");
  });

  test("steps, ranges and lists", () => {
    expect(nextAfter("*/15 * * * *", 2026, 3, 10, 10, 16)).toBe("2026-03-10 10:30");
    expect(nextAfter("*/15 * * * *", 2026, 3, 10, 10, 46)).toBe("2026-03-10 11:00");
    expect(nextAfter("10-30/10 4 * * *", 2026, 3, 10, 4, 11)).toBe("2026-03-10 04:20");
    expect(nextAfter("0,30 8 * * *", 2026, 3, 10, 8, 5)).toBe("2026-03-10 08:30");
    expect(nextAfter("0 9-11 * * *", 2026, 3, 10, 11, 0)).toBe("2026-03-11 09:00");
    expect(nextAfter("0 */6 * * *", 2026, 3, 10, 7, 0)).toBe("2026-03-10 12:00");
    expect(nextAfter("0 0 1,15 * *", 2026, 3, 2)).toBe("2026-03-15 00:00");
  });

  test("day of week: 0 and 7 are Sunday, ranges and lists", () => {
    // 2026-03-10 is a Tuesday.
    expect(nextAfter("0 2 * * 0", 2026, 3, 10)).toBe("2026-03-15 02:00");
    expect(nextAfter("0 2 * * 7", 2026, 3, 10)).toBe("2026-03-15 02:00");
    expect(nextAfter("0 9 * * 1-5", 2026, 3, 13, 9, 0)).toBe("2026-03-16 09:00");
    expect(nextAfter("0 9 * * 2,4", 2026, 3, 10, 9, 0)).toBe("2026-03-12 09:00");
  });

  test("month and day of month; a day that never exists gives undefined", () => {
    expect(nextAfter("0 0 5 7 *", 2026, 3, 10)).toBe("2026-07-05 00:00");
    expect(nextAfter("0 0 1 1 *", 2026, 1, 1)).toBe("2027-01-01 00:00");
    expect(nextAfter("0 0 31 * *", 2026, 4, 1)).toBe("2026-05-31 00:00");
    expect(nextAfter("0 0 29 2 *", 2026, 3, 1)).toBe("2028-02-29 00:00");
    expect(nextAfter("0 0 31 2 *", 2026, 3, 1)).toBeUndefined();
  });

  test("both day fields restricted: a day that matches either one runs", () => {
    // the 15th or a Friday: 2026-03-10 (Tue) -> Friday the 13th comes before the 15th
    expect(nextAfter("0 0 15 * 5", 2026, 3, 10)).toBe("2026-03-13 00:00");
    expect(nextAfter("0 0 15 * 5", 2026, 3, 13, 0, 0)).toBe("2026-03-15 00:00");
    // `*/2` does not restrict the day: only the day of week counts, so a Sunday that is an even day does not run twice
    expect(nextAfter("0 0 */2 * 0", 2026, 3, 10)).toBe("2026-03-15 00:00");
  });

  test("an invalid expression has no next run", () => {
    expect(next("60 3 * * *")).toBeUndefined();
    expect(next("@reboot")).toBeUndefined();
    expect(next("* * * *")).toBeUndefined();
  });

  test("`from` defaults to now and the answer is in the future", () => {
    const before = Date.now();
    const found = next("* * * * *");
    expect(found!.getTime()).toBeGreaterThan(before);
    expect(found!.getTime() - before).toBeLessThanOrEqual(60_000);
  });

  test("daylight saving: a time the clock skips is not a run, a daily run keeps its wall time", () => {
    // New York, 2026-03-08: the clock jumps from 02:00 to 03:00, so 02:30 does not exist that day.
    expect(nextAfter("30 2 * * *", 2026, 3, 7, 12)).toBe("2026-03-09 02:30");
    expect(nextAfter("30 3 * * *", 2026, 3, 7, 12)).toBe("2026-03-08 03:30");
    // The day after the jump is 23 hours long from midnight: the hour still reads 03:30.
    expect(nextAfter("30 3 * * *", 2026, 3, 8, 4)).toBe("2026-03-09 03:30");
    // Every hour: the skipped 02:00 is simply not there.
    expect(nextAfter("0 * * * *", 2026, 3, 8, 1, 30)).toBe("2026-03-08 03:00");
  });

  test("daylight saving: a repeated time runs once, and the next day keeps its wall time", () => {
    // New York, 2026-11-01: the clock goes back from 02:00 to 01:00, so 01:30 happens twice.
    const first = next("30 1 * * *", new Date(2026, 10, 1, 0, 0));
    expect(show(first)).toBe("2026-11-01 01:30");
    const afterFirst = new Date(first!.getTime() + 1000);
    expect(show(next("30 1 * * *", afterFirst))).toBe("2026-11-02 01:30");
    // 90 minutes after the first 01:30 the clock reads 01:30 again: still not a second run.
    expect(show(next("30 1 * * *", new Date(first!.getTime() + 60 * 60_000)))).toBe("2026-11-02 01:30");
  });
});
