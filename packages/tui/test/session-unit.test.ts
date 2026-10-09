import { expect, test } from "bun:test";
import { join } from "node:path";
import { createRegistry, pvxHome } from "@pvx/core";
import { complete, createSessionStore, MAX_BLOCKS, sanitize } from "../src/index.ts";

const noop = () => {};
const registry = createRegistry();
registry.register({ id: "ssl", version: "1", entry: "x" }, {
  commands: {
    renew: { help: "renova", args: [{ name: "mode", help: "m", kind: "option", values: ["fast", "slow"] }, { name: "dry-run", help: "d", kind: "flag" }], run: noop },
    revoke: { help: "revoga", destructive: true, run: noop },
    "pre-renew": { help: "x", run: noop },
  },
});

registry.register({ id: "renew", version: "1", entry: "x" }, { commands: { "": { help: "top", run: noop } } });

test("complete: prefix before contains, with range; destructive is marked", () => {
  const { items } = complete(registry, "renew");
  expect(items.map((i) => i.label)).toEqual(["renew", "ssl renew", "ssl pre-renew"]);
  expect(items[0]!.range).toEqual([0, 5]);
  expect(items[2]!.range).toEqual([8, 13]);
  expect(complete(registry, "ssl rev").items[0]).toMatchObject({ label: "ssl revoke", destructive: true });
});

test("complete: flags and values from ArgSpec", () => {
  expect(complete(registry, "ssl renew --d").items.map((i) => i.text)).toEqual(["--dry-run "]);
  expect(complete(registry, "ssl renew --mode ").items.map((i) => i.label)).toEqual(["fast", "slow"]);
  expect(complete(registry, "ssl renew --mode f").start).toBe("ssl renew --mode ".length);
});

test("sanitize strips ANSI and control chars", () => {
  expect(sanitize("\x1b[31mred\x1b[0m\x07 ok\r")).toEqual(["red ok"]);
});

test("store keeps at most 500 blocks", async () => {
  const store = createSessionStore({ registry, makeLogger: () => ({ debug: noop, info: noop, warn: noop, error: noop }), historyPath: join(pvxHome(), "h") });
  for (let i = 0; i < MAX_BLOCKS + 5; i++) await store.run(`nope${i}`);
  expect(store.blocks).toHaveLength(MAX_BLOCKS);
  expect(store.blocks.at(-1)!.line).toBe(`nope${MAX_BLOCKS + 4}`);
});

test("secrets passed to run reach the command but not blocks or history", async () => {
  const reg = createRegistry();
  reg.register({ id: "m", version: "1", entry: "x" }, {
    commands: { login: { help: "l", args: [{ name: "token", help: "t", kind: "option", secret: true, required: true }], run: (ctx) => ctx.out.success(`len ${String(ctx.args.token).length}`) } },
  });
  const store = createSessionStore({ registry: reg, makeLogger: () => ({ debug: noop, info: noop, warn: noop, error: noop }), historyPath: join(pvxHome(), "h2") });
  await store.run("m login", { secrets: { token: "s3cr3tvalue" } });
  expect(store.blocks[0]!.lines[0]!.text).toBe("len 11");
  expect(JSON.stringify(store.getSnapshot())).not.toContain("s3cr3tvalue");
});
