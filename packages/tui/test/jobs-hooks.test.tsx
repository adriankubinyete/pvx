import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { jobsConfig } from "@pvx/core";
import { renderPage, type TuiHarness } from "../../testing/src/index.ts";

const FIX = join(import.meta.dir, "../../core/test/fixtures");
const saved = { ...jobsConfig };
let h: TuiHarness | undefined;
beforeEach(() => {
  jobsConfig.selfCmd = () => [process.execPath, join(FIX, "job-main.ts")];
  jobsConfig.systemd = () => false;
});
afterEach(() => (h?.destroy(), Object.assign(jobsConfig, saved)));

/** Polls by time (`waitForFrame` counts frames, and these tests wait on timers and a child process). */
async function until(pred: (f: string) => boolean, ms = 8000): Promise<string> {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    await h!.flush();
    if (pred(h!.frame())) return h!.frame();
    await Bun.sleep(50);
  }
  throw new Error(`timeout:\n${h!.frame()}`);
}
const num = (f: string, k: string) => Number(f.match(new RegExp(`${k}=(\\d+)`))?.[1]);

test("useQuery with refreshMs re-runs on an interval (min 500 ms) and a stable result does not re-render", async () => {
  h = await renderPage(join(FIX, "jobmodules/hooks-demo"), "queries", { cols: 80, rows: 24 });
  const first = await until((f) => f.includes("tick=1"));
  expect(first).toContain("same=7");
  const t0 = Date.now();
  const f = await until((x) => num(x, "tick") >= 3);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // two refreshes at >= 500 ms each, not the 10 ms asked
  expect(num(f, "renders")).toBeLessThan(12);
});

test("useJob: start from the page, status goes running to done, lines are the tail, and it stays quiet after", async () => {
  h = await renderPage(join(FIX, "jobmodules/hooks-demo"), "job", { cols: 100, rows: 24 });
  expect(h.frame()).toContain("job=none");
  await h.press("s");
  await until((f) => f.includes("job=running") || f.includes("job=done"));
  const done = await until((f) => f.includes("job=done"));
  expect(done).toContain("exit=0");
  expect(done).toContain("lines=i l2|i l3|i l4"); // tail 3 of four lines
  await Bun.sleep(1300);
  await h.flush();
  const a = num(h.frame(), "renders");
  await Bun.sleep(2100);
  await h.flush();
  expect(h.frame()).toContain("job=done");
  expect(num(h.frame(), "renders") - a).toBe(0); // two polls with nothing new: no render
}, 20_000);
