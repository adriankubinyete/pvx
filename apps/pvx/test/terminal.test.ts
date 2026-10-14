import { describe, expect, test } from "bun:test";
import { createCliRenderer } from "@opentui/core";
import { PassThrough } from "node:stream";
import { KITTY_POP_ALL, resetKeyboard, resetKeyboardOnExit } from "../src/terminal.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("terminal reset", () => {
  test("resetKeyboard pops every kitty level", () => {
    const out: string[] = [];
    resetKeyboard((s) => out.push(s));
    expect(out).toEqual(["\x1b[<99u"]);
    expect(KITTY_POP_ALL).toBe("\x1b[<99u");
  });

  test("a failing write never throws", () => {
    expect(() => resetKeyboard(() => { throw new Error("EPIPE"); })).not.toThrow();
  });

  test("the exit hook writes on process exit and is removable; nothing without a TTY", () => {
    const before = process.listenerCount("exit");
    expect(resetKeyboardOnExit(false)).toBeInstanceOf(Function);
    expect(process.listenerCount("exit")).toBe(before);
    const out: string[] = [];
    const off = resetKeyboardOnExit(true, (s) => out.push(s));
    expect(process.listenerCount("exit")).toBe(before + 1);
    const hook = process.listeners("exit").at(-1) as () => void;
    hook();
    expect(out).toEqual([KITTY_POP_ALL]);
    off();
    expect(process.listenerCount("exit")).toBe(before);
  });
});

// Pins the OpenTUI behaviour the fix relies on: the renderer pushes kitty flags only after the terminal answers `CSI ? u`,
// and its teardown pops them BEFORE it leaves the alternate screen (kitty terminals keep one stack per screen).
describe("renderer teardown", () => {
  test("pops the kitty keyboard flags it pushed, before leaving the alternate screen", async () => {
    const chunks: string[] = [];
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    stdout.on("data", (b: Buffer) => chunks.push(b.toString("latin1")));
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin });
    const renderer = await createCliRenderer({ stdin: stdin as never, stdout: stdout as never, exitOnCtrlC: false });
    await wait(50);
    stdin.write("\x1b[?0u\x1b[?62;c"); // the terminal answers the kitty query and DA1
    await wait(200);
    const started = chunks.join("");
    expect(started.match(/\x1b\[>\d+u/g)?.length).toBe(1);
    chunks.length = 0;
    renderer.destroy();
    await wait(200);
    const teardown = chunks.join("");
    expect(teardown.match(/\x1b\[<u/g)?.length).toBe(1);
    expect(teardown.indexOf("\x1b[<u")).toBeLessThan(teardown.indexOf("\x1b[?1049l"));
    expect(teardown).toContain("\x1b[?1006l"); // mouse tracking off
    expect(teardown).toContain("\x1b[?25h"); // cursor back
  });
});
