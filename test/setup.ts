import { beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pvx-home-"));
  process.env.PVX_HOME = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
