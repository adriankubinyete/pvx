import { afterEach, expect, test } from "bun:test";
import { useState, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { StepItem } from "@pvx/sdk";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { ThemeProvider } from "../src/index.ts";
import { clock, LogTail, Steps } from "../src/sdk-ui/kit.tsx";

const StepsView = Steps as (p: Parameters<typeof Steps>[0]) => ReactNode;
const Tail = LogTail as (p: Parameters<typeof LogTail>[0]) => ReactNode;
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const items: StepItem[] = [
  { id: "a", label: "preparar", state: "done", elapsedMs: 4200 },
  { id: "b", label: "instalar pacotes", state: "running", elapsedMs: 185_000, detail: "142/180" },
  { id: "c", label: "banco de dados", state: "pending" },
  { id: "d", label: "schema", state: "failed", elapsedMs: 1000, detail: "sem acesso" },
  { id: "e", label: "limpar", state: "skipped" },
];

test("Steps: one row per item with glyph, label, state word, elapsed and detail at 80x24", async () => {
  h = await renderTui(<ThemeProvider><StepsView items={items} /></ThemeProvider>, { cols: 80, rows: 24 });
  const rows = h.frame().split("\n");
  expect(rows[0]).toMatch(/^✓ preparar +concluído +4s/);
  expect(rows[1]).toMatch(/^\S instalar pacotes +rodando +3m05s +142\/180/);
  expect(rows[2]).toMatch(/^○ banco de dados +pendente/);
  expect(rows[3]).toMatch(/^✗ schema +falhou +1s +sem acesso/);
  expect(rows[4]).toMatch(/^- limpar +pulado/);
  expect(rows.slice(0, 5).every((r) => [...r].length <= 80)).toBe(true);
});

test("Steps: the spinner ticks only while an item runs", async () => {
  h = await renderTui(<ThemeProvider><StepsView items={items} /></ThemeProvider>, { cols: 80, rows: 24 });
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    seen.add(h.frame().split("\n")[1]![0]!);
    await Bun.sleep(120);
    await h.flush();
  }
  expect(seen.size).toBeGreaterThan(1);
  h.destroy();
  h = await renderTui(<ThemeProvider><StepsView items={items.map((i) => (i.state === "running" ? { ...i, state: "done" as const } : i))} /></ThemeProvider>, { cols: 80, rows: 24 });
  const before = h.frame();
  await Bun.sleep(300);
  await h.flush();
  expect(h.frame()).toBe(before);
});

test("clock formats seconds, minutes and hours", () => {
  expect([clock(4200), clock(185_000), clock(3_720_000)]).toEqual(["4s", "3m05s", "1h02m"]);
});

function Growing() {
  const [n, setN] = useState(30);
  useKeyboard((k) => k.name === "x" && setN((v) => v + 20));
  return <box height={10} flexDirection="column"><Tail lines={Array.from({ length: n }, (_, i) => `linha ${i + 1}`)} /></box>;
}

test("LogTail: shows the end and keeps following as lines arrive; strips escapes", async () => {
  h = await renderTui(<ThemeProvider><Growing /></ThemeProvider>, { cols: 80, rows: 24 });
  await h.flush();
  expect(h.frame()).toContain("linha 30");
  expect(h.frame()).not.toContain("linha 1 ");
  await h.press("x");
  await h.flush();
  expect(h.frame()).toContain("linha 50");
  expect(h.frame().trimEnd().split("\n").length).toBeLessThanOrEqual(10);
  h.destroy();
  h = await renderTui(<ThemeProvider><Tail lines={["\x1b[31mvermelho\x1b[0m"]} /></ThemeProvider>, { cols: 40, rows: 5 });
  expect(h.frame()).toContain("vermelho");
  expect(h.frame()).not.toContain("\x1b");
});

test("LogTail: empty shows a dash", async () => {
  h = await renderTui(<ThemeProvider><Tail lines={[]} /></ThemeProvider>, { cols: 40, rows: 5 });
  expect(h.frame()).toContain("—");
});
