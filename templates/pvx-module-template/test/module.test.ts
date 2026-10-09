import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { renderPage, runCommand, type TuiHarness } from "@pvx/testing";

const dir = join(import.meta.dir, "..");
let t: TuiHarness | undefined;
afterEach(() => t?.destroy());

test("saudar diz olá ao nome recebido", async () => {
  const r = await runCommand(dir, "exemplo saudar Ana");
  expect(r).toEqual({ ok: true, exit: 0, lines: [{ kind: "success", text: "olá, Ana" }] });
});

test("sem nome, saúda o mundo", async () => {
  expect((await runCommand(dir, "exemplo saudar")).lines[0]?.text).toBe("olá, mundo");
});

test("a página mostra o estado e reage à tecla s", async () => {
  t = await renderPage(dir, "painel", { cols: 80, rows: 24 });
  expect(t.frame()).toContain("ninguém foi saudado");
  await t.press("s");
  expect(t.frame()).toContain("olá, mundo");
});
