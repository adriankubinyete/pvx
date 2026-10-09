import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  const store = createSessionStore({ registry, makeLogger: () => ({ debug: noop, info: noop, warn: noop, error: noop }), historyPath: join(pvxHome(), "h"), isRoot: true });
  for (let i = 0; i < MAX_BLOCKS + 5; i++) await store.run(`nope${i}`);
  expect(store.blocks).toHaveLength(MAX_BLOCKS);
  expect(store.blocks.at(-1)!.line).toBe(`nope${MAX_BLOCKS + 4}`);
});

test("secrets passed to run reach the command but not blocks or history", async () => {
  const reg = createRegistry();
  reg.register({ id: "m", version: "1", entry: "x" }, {
    commands: { login: { help: "l", args: [{ name: "token", help: "t", kind: "option", secret: true, required: true }], run: (ctx) => ctx.out.success(`len ${String(ctx.args.token).length}`) } },
  });
  const store = createSessionStore({ registry: reg, makeLogger: () => ({ debug: noop, info: noop, warn: noop, error: noop }), historyPath: join(pvxHome(), "h2"), isRoot: true });
  await store.run("m login", { secrets: { token: "s3cr3tvalue" } });
  expect(store.blocks[0]!.lines[0]!.text).toBe("len 11");
  expect(JSON.stringify(store.getSnapshot())).not.toContain("s3cr3tvalue");
});

const login = {
  commands: { login: { help: "l", args: [{ name: "loud", help: "l", kind: "flag" as const }, { name: "token", help: "t", kind: "option" as const, secret: true, required: true }], run: (ctx: { args: Record<string, unknown>; out: { success(t: string): void } }) => ctx.out.success(`len ${String(ctx.args.token).length}`) } },
};
const quiet = { debug: noop, info: noop, warn: noop, error: noop };

test("repeat of a block with a secret asks for the secret again instead of passing the masked `***`", async () => {
  // Cause: the block keeps the masked line (`m login ***`), and repeat re-ran that text, so a literal `***` reached the parser.
  const reg = createRegistry();
  reg.register({ id: "m", version: "1", entry: "x" }, login);
  const store = createSessionStore({ registry: reg, makeLogger: () => quiet, historyPath: join(pvxHome(), "h3"), isRoot: true });
  await store.run("m login --loud", { secrets: { token: "s3cr3tvalue" } });
  expect(store.blocks[0]!.line).toBe("m login ***");
  expect(store.lineOf(store.blocks[0]!.id)).toBe("m login --loud");
  const again = store.repeat(store.blocks[0]!.id);
  expect(store.getSnapshot().pending).toMatchObject([{ kind: "secret", name: "token" }]);
  store.answer(store.getSnapshot().pending[0]!.id, "other-s3cret");
  await again;
  expect(store.blocks[1]!.lines[0]!.text).toBe("len 12");
  expect(JSON.stringify(store.getSnapshot())).not.toContain("s3cr3tvalue");
  expect(JSON.stringify(store.getSnapshot())).not.toContain("other-s3cret");
  expect(readFileSync(join(pvxHome(), "h3"), "utf8")).toBe("m login ***\n");
});

test("strict root: a module command in a non-root TUI is an error block and does not run", async () => {
  let ran = 0;
  const reg = createRegistry();
  reg.register({ id: "m", version: "1", entry: "x" }, { commands: { hi: { help: "h", run: () => void ran++ } } });
  const store = createSessionStore({ registry: reg, makeLogger: () => quiet, historyPath: join(pvxHome(), "h4"), isRoot: false });
  expect((await store.run("m hi")).exit).toBe(1);
  expect(ran).toBe(0);
  expect(store.blocks[0]).toMatchObject({ status: "error", lines: [{ kind: "error", text: expect.stringContaining("rode com sudo") }] });
});
