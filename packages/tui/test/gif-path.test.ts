import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanGifPath } from "../src/tabs/gif-path.ts";
import { decodeGif } from "../src/tabs/gif-frames.ts";

test("cleanGifPath: quotes, escaped spaces and ~ of a path that was dropped on the terminal", () => {
  expect(cleanGifPath("  /tmp/clip.gif \n")).toBe("/tmp/clip.gif");
  expect(cleanGifPath("'/tmp/my clip.gif'")).toBe("/tmp/my clip.gif");
  expect(cleanGifPath('"/tmp/my clip.gif"')).toBe("/tmp/my clip.gif");
  expect(cleanGifPath("/tmp/my\\ clip.gif")).toBe("/tmp/my clip.gif");
  expect(cleanGifPath("~/Downloads/a.gif")).toBe(join(homedir(), "Downloads/a.gif"));
  expect(cleanGifPath("~")).toBe(homedir());
  expect(cleanGifPath("   ")).toBe("");
});

test("decodeGif refuses what is not a GIF", () => {
  expect(() => decodeGif(new TextEncoder().encode("isto não é um gif"))).toThrow();
});
