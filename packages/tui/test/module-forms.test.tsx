import { afterEach, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { join } from "node:path";
import { tokens } from "../src/index.ts";
import { expectButtonsReachable, expectNoKeyboardTrap, renderTab, type TuiHarness } from "../../testing/src/index.ts";

const FORMS = join(import.meta.dir, "../../core/test/fixtures/jobmodules/forms-demo");
const SIZES = [{ cols: 80, rows: 24 }, { cols: 120, rows: 40 }];
let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

const lineWith = (text: string): string => h!.frame().split("\n").find((line) => line.includes(text)) ?? "";

for (const size of SIZES) {
  test(`${size.cols}x${size.rows}: the Panel aside sits at the right end of the section header`, async () => {
    h = await renderTab(FORMS, "section", size);
    const header = lineWith("Rotinas");
    expect(header).toContain("2 rotinas · próxima hoje 03:30");
    expect(header.indexOf("Rotinas")).toBeLessThan(header.indexOf("2 rotinas"));
    expect(header.trimEnd().endsWith("03:30")).toBe(true);
  });

  test(`${size.cols}x${size.rows}: ButtonRow is one stop: ↑↓ reach it, ←→ walk it, enter presses, and only the current button is filled`, async () => {
    h = await renderTab(FORMS, "section", size);
    expect(lineWith("[ novo ]")).toContain("[ novo ]  [ rodar agora ]  [ sem token ]  [ apagar ]");
    expect(h.frame()).toContain("parada=a");
    await h.press("ARROW_DOWN");
    await h.press("ARROW_DOWN");
    expect(h.frame()).toContain("parada=actions");
    expect(h.frame()).toContain("enter ativa");
    await h.press("RETURN");
    expect(h.frame()).toContain("pressionados=novo");
    await h.press("ARROW_RIGHT");
    await h.press("RETURN");
    expect(h.frame()).toContain("pressionados=novo,rodar");
    await h.press("ARROW_RIGHT"); // a disabled button: the focus rests on it, enter does nothing
    expect(h.frame()).toContain("falta o token");
    await h.press("RETURN");
    expect(h.frame()).toContain("pressionados=novo,rodar ");
    await h.press("ARROW_LEFT");
    await h.press("ARROW_LEFT"); // wraps from the first to the last
    await h.press("ARROW_LEFT");
    await h.press("RETURN");
    expect(h.frame()).toContain("pressionados=novo,rodar,apagar");
    await h.press("ARROW_DOWN"); // out of the row: the page's stop moves on and the row loses its keys
    expect(h.frame()).toContain("parada=a");
    expect(h.frame()).not.toContain("enter ativa");
  });

  test(`${size.cols}x${size.rows}: only the current button of a focused ButtonRow is filled`, async () => {
    h = await renderTab(FORMS, "section", size);
    const filled = (label: string) => h!.spans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(label))!.bg.equals(RGBA.fromHex(tokens.accent));
    expect(filled("[ novo ]")).toBe(false); // the page's stop is on a list row
    await h.press("ARROW_DOWN");
    await h.press("ARROW_DOWN");
    expect([filled("[ novo ]"), filled("[ rodar agora ]")]).toEqual([true, false]);
    await h.press("ARROW_RIGHT");
    expect([filled("[ novo ]"), filled("[ rodar agora ]")]).toEqual([false, true]);
  });

  test(`${size.cols}x${size.rows}: a click presses a ButtonRow button`, async () => {
    h = await renderTab(FORMS, "section", size);
    const row = h.frame().split("\n").findIndex((line) => line.includes("[ rodar agora ]"));
    const column = h.frame().split("\n")[row]!.indexOf("[ rodar agora ]") + 3;
    await h.click(column, row);
    expect(h.frame()).toContain("pressionados=rodar");
  });

  test(`${size.cols}x${size.rows}: a ButtonRow counts for expectButtonsReachable and does not trap the keyboard`, async () => {
    h = await renderTab(FORMS, "section", size);
    expectButtonsReachable();
    await h.press("ARROW_DOWN");
    await h.press("ARROW_DOWN");
    expectButtonsReachable();
    await expectNoKeyboardTrap(h);
  });
}

test("a ButtonRow without `focused` and without keys is reported as unreachable", async () => {
  const { ButtonRow } = (await import("../src/sdk-ui/index.tsx")).ui;
  const { renderTui } = await import("../../testing/src/index.ts");
  const { ThemeProvider } = await import("../src/index.ts");
  const { HostCtx } = await import("../src/sdk-ui/host.tsx");
  const { unreachableButtons } = await import("../src/sdk-ui/button.tsx");
  const Row = ButtonRow as (props: Record<string, unknown>) => React.ReactNode;
  const host = { addKey: () => () => {} } as never;
  h = await renderTui(
    <ThemeProvider><HostCtx.Provider value={host}><Row buttons={[{ label: "solto", onPress: () => {} }]} /></HostCtx.Provider></ThemeProvider>,
    { cols: 80, rows: 24 },
  );
  expect(unreachableButtons()).toEqual(["solto"]);
});

test("useJobLog opens the whole log of a job of the module in the Comando tab", async () => {
  h = await renderTab(FORMS, "job-log", { cols: 100, rows: 30 });
  await h.press("l");
  for (const end = Date.now() + 3000; !h.frame().includes("jobs log forms-demo backup") && Date.now() < end; ) {
    await Bun.sleep(10);
    await h.flush();
  }
  expect(h.frame()).toContain("jobs log forms-demo backup");
  expect(h.frame()).toContain("job inexistente: forms-demo/backup");
  expect(h.frame()).not.toContain("o log do backup"); // the Comando tab came to the front
});
