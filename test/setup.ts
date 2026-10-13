import { beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pvx-home-"));
  process.env.PVX_HOME = dir;
  process.env.PVX_CATALOG_URL = "http://127.0.0.1:9/catalog.json"; // refused at once: tests never reach the real registry
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
