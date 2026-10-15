import { expect, test } from "bun:test";
import { editLine, lineOf, pastedText, windowLine, type EditKey } from "../src/lineedit.ts";

const key = (name: string, extra: Partial<EditKey> = {}): EditKey => ({ name, sequence: "", ...extra });
const ch = (c: string): EditKey => ({ name: c, sequence: c });

test("insert at the cursor, backspace and delete", () => {
  let l = lineOf("abc");
  l = editLine({ ...l, cursor: 1 }, ch("X"))!;
  expect(l).toEqual({ text: "aXbc", cursor: 2 });
  l = editLine(l, key("backspace"))!;
  expect(l).toEqual({ text: "abc", cursor: 1 });
  l = editLine(l, key("delete"))!;
  expect(l).toEqual({ text: "ac", cursor: 1 });
  expect(editLine({ text: "a", cursor: 0 }, key("backspace"))).toEqual({ text: "a", cursor: 0 });
  expect(editLine({ text: "a", cursor: 1 }, key("delete"))).toEqual({ text: "a", cursor: 1 });
});

test("arrows, home/end, ctrl+a/e", () => {
  expect(editLine({ text: "abc", cursor: 1 }, key("left"))).toEqual({ text: "abc", cursor: 0 });
  expect(editLine({ text: "abc", cursor: 1 }, key("right"))).toEqual({ text: "abc", cursor: 2 });
  expect(editLine({ text: "abc", cursor: 1 }, key("end"))!.cursor).toBe(3);
  expect(editLine({ text: "abc", cursor: 2 }, key("home"))!.cursor).toBe(0);
  expect(editLine({ text: "abc", cursor: 2 }, key("a", { ctrl: true }))!.cursor).toBe(0);
  expect(editLine({ text: "abc", cursor: 0 }, key("e", { ctrl: true }))!.cursor).toBe(3);
});

test("crossing a boundary signals exit and leaves the line alone", () => {
  expect(editLine({ text: "abc", cursor: 0 }, key("left"))).toEqual({ text: "abc", cursor: 0, exit: "left" });
  expect(editLine({ text: "abc", cursor: 3 }, key("right"))).toEqual({ text: "abc", cursor: 3, exit: "right" });
  expect(editLine({ text: "", cursor: 0 }, key("left"))!.exit).toBe("left");
});

test("ctrl+w deletes the previous word", () => {
  expect(editLine({ text: "demo greet  ana", cursor: 15 }, key("w", { ctrl: true }))).toEqual({ text: "demo greet  ", cursor: 12 });
  expect(editLine({ text: "demo greet", cursor: 5 }, key("w", { ctrl: true }))).toEqual({ text: "greet", cursor: 0 });
});

test("code points are not split; other keys are not handled", () => {
  expect(editLine({ text: "a😀", cursor: 2 }, key("backspace"))).toEqual({ text: "a", cursor: 1 });
  expect(editLine(lineOf("x"), key("up"))).toBeUndefined();
  expect(editLine(lineOf("x"), key("k", { ctrl: true }))).toBeUndefined();
  expect(editLine(lineOf("x"), key("return", { sequence: "\r" }))).toBeUndefined();
  expect(editLine(lineOf("x"), ch("b"), )!.text).toBe("xb");
  expect(editLine(lineOf("x"), { name: "b", sequence: "b", meta: true })).toBeUndefined();
});

test("windowLine keeps the cursor inside the width", () => {
  expect(windowLine({ text: "abc", cursor: 3 }, 10)).toEqual(["abc", " ", ""]);
  expect(windowLine({ text: "abcdefghij", cursor: 10 }, 5)).toEqual(["ghij", " ", ""]);
  expect(windowLine({ text: "abcdefghij", cursor: 0 }, 5)).toEqual(["", "a", "bcde"]);
  const [b, u, a] = windowLine({ text: "abcdefghij", cursor: 5 }, 5);
  expect(`${b}${u}${a}`).toContain("f");
  expect([...b + u + a].length).toBeLessThanOrEqual(5);
});

test("paste inserts at the cursor and a one-line field drops escapes, line breaks and control characters", () => {
  expect(editLine({ text: "ab", cursor: 1 }, { name: "paste", sequence: "", paste: "XY" })).toEqual({ text: "aXYb", cursor: 3 });
  expect(pastedText("pass\r\nword\n")).toBe("password");
  expect(pastedText("\x1b[31mred\x1b[0m\x1b]0;title\x07\ttab\x00")).toBe("redtab");
  expect(editLine(lineOf("x"), { name: "paste", sequence: "", paste: "\n" })).toEqual({ text: "x", cursor: 1 });
});
