import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { runSession, type TuiHarness } from "@pvx/testing";
import { proveGreeting } from "../src/health/prove.ts";
import { STORE_KEY } from "../src/state.ts";
import { fakeSdk, memStore } from "./fake.ts";

const dir = join(import.meta.dir, "..");
let page: TuiHarness | undefined;
afterEach(() => page?.destroy());

test("saudar diz olá ao nome recebido; sem nome, saúda o mundo", async () => {
  const session = await runSession(dir);
  expect((await session.run("exemplo saudar Ana")).lines).toEqual([{ kind: "success", text: "olá, Ana" }]);
  expect((await session.run("exemplo saudar")).text).toBe("olá, mundo");
});

test("a capacidade avisa até alguém ser saudado", async () => {
  const { proof } = fakeSdk();
  expect(await proveGreeting(proof, memStore())).toMatchObject({ level: "warn", fix: "exemplo saudar" });
  expect(await proveGreeting(proof, memStore({ [STORE_KEY.last]: "Ana" }))).toMatchObject({ level: "ok" });
});

test("a página lista os saudados e o botão saúda o mundo", async () => {
  const session = await runSession(dir);
  await session.run("exemplo saudar Ana");
  page = await session.renderPage("painel", { cols: 80, rows: 24 });
  expect(page.frame()).toContain("Ana");
  await page.press("s");
  await page.waitForFrame((frame) => frame.includes("mundo"));
});
