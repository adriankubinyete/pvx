import { expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logsDir } from "../../src/engine/paths.ts";
import { createLogger } from "../../src/logs/logger.ts";
import { followLogs, readLogs } from "../../src/logs/reader.ts";

const dir = () => logsDir(); // temp PVX_HOME from preload

test("format, multi-line and rotation (max 3 backups)", () => {
  const d = dir();
  const log = createLogger(d, "mod", { maxBytes: 500 });
  log.error("boom\n  at a\n  at b");
  const text = readFileSync(join(d, "mod.log"), "utf8");
  expect(text).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z ERROR mod: boom\n\t {2}at a\n\t {2}at b\n$/);
  for (let i = 0; i < 100; i++) log.info("x".repeat(50));
  const files = readdirSync(d).sort();
  expect(files).toEqual(["mod.log", "mod.log.1", "mod.log.2", "mod.log.3"]);
  expect(readLogs({ logsDir: d, modules: ["mod"], tail: 1 })).toHaveLength(1);
});

test("readLogs merges modules by time and applies tail", () => {
  const d = dir();
  mkdirSync(d, { recursive: true });
  const l = (t: number, n: string) => `2026-01-01T00:00:0${t}.000Z INFO ${n}: m${t}\n`;
  appendFileSync(join(d, "a.log"), l(1, "a") + l(3, "a") + "2026-01-01T00:00:05.000Z ERROR a: e\n\tstack\n");
  appendFileSync(join(d, "b.log"), l(2, "b") + l(4, "b"));
  const all = readLogs({ logsDir: d, modules: "all" });
  expect(all.map((x) => x.slice(20, 23))).toEqual(["000", "000", "000", "000", "000"]);
  expect(all.map((x) => x.split(" ")[2])).toEqual(["a:", "b:", "a:", "b:", "a:"]);
  const tail = readLogs({ logsDir: d, tail: 2 });
  expect(tail).toEqual([l(4, "b").trim(), "2026-01-01T00:00:05.000Z ERROR a: e\n\tstack"]);
});

test("ACCEPTANCE: follow --all merges two concurrent writer processes in time order", async () => {
  const d = dir();
  mkdirSync(d, { recursive: true });
  const ac = new AbortController();
  const got: string[] = [];
  const done = followLogs({ logsDir: d, modules: "all", pollMs: 20, holdMs: 150 }, (l) => got.push(l), ac.signal);
  const w = (name: string) =>
    Bun.spawn(["bun", join(import.meta.dir, "writer.ts"), d, name, "60"], { stdout: "inherit", stderr: "inherit" }).exited;
  await Promise.all([w("alpha"), w("beta")]);
  await Bun.sleep(300);
  ac.abort();
  await done;
  expect(got).toHaveLength(120);
  for (const n of ["alpha", "beta"]) {
    for (let i = 0; i < 60; i++) expect(got.filter((l) => l.endsWith(`${n}: ${n} ${i}`))).toHaveLength(1);
  }
  const ts = got.map((l) => l.slice(0, 24));
  expect(ts).toEqual([...ts].sort());
});

test("follow buffers partial lines and picks up rotation", async () => {
  const d = dir();
  mkdirSync(d, { recursive: true });
  const f = join(d, "m.log");
  appendFileSync(f, "2026-01-01T00:00:00.000Z INFO m: old\n");
  const ac = new AbortController();
  const got: string[] = [];
  const done = followLogs({ logsDir: d, modules: ["m"], pollMs: 10, holdMs: 0 }, (l) => got.push(l), ac.signal);
  appendFileSync(f, "2026-01-01T00:00:01.000Z INFO m: par");
  await Bun.sleep(60);
  expect(got).toEqual([]); // old skipped, partial held
  appendFileSync(f, "tial\n");
  await Bun.sleep(60);
  expect(got).toEqual(["2026-01-01T00:00:01.000Z INFO m: partial"]);
  ac.abort();
  await done;
  expect(existsSync(f)).toBe(true);
});
