import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createStore, moduleStateDir } from "../../src/index.ts";

const MODE_MASK = 0o777;
const modeOf = (path: string) => statSync(path).mode & MODE_MASK;
const itPosix = process.platform === "win32" ? test.skip : test;

describe("module store permissions", () => {
  itPosix("writes state.json with 0600 in a 0700 directory", () => {
    createStore("modo").set("chave", "segredo");
    const dir = moduleStateDir("modo");
    expect(modeOf(join(dir, "state.json"))).toBe(0o600);
    expect(modeOf(dir)).toBe(0o700);
  });

  itPosix("tightens an existing loose state.json on the next write", () => {
    const dir = moduleStateDir("solto");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "state.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o644);
    createStore("solto").set("chave", 1);
    expect(modeOf(file)).toBe(0o600);
  });
});
