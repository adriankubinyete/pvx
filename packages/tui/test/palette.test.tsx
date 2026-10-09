import { afterEach, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { createRegistry, loadModules, type Registry } from "@pvx/core";
import { renderTui, type TuiHarness } from "../../testing/src/index.ts";
import { KeyRouter, ThemeProvider } from "../src/index.ts";
import { Palette, type SessionLike } from "../src/palette/Palette.tsx";
import { loadFavorites } from "../src/palette/favorites.ts";
import { buildLine } from "../src/palette/form.ts";
import { search } from "../src/palette/search.ts";

let h: TuiHarness | undefined;
afterEach(() => h?.destroy());

let registry: Registry;
beforeAll(async () => {
  process.env.PVX_USERMODULES = join(import.meta.dir, "../../core/test/fixtures/usermodules");
  registry = createRegistry();
  const noop = { debug() {}, info() {}, warn() {}, error() {} };
  await loadModules(registry, { hostVersion: "1.0.0", makeLogger: () => noop });
});

function fake(failing = "") {
  const calls: { line: string; secrets?: Record<string, string> }[] = [];
  const session: SessionLike = {
    history: ["demo greet ana"],
    async run(line, opts) {
      calls.push({ line, secrets: opts?.secrets });
      return { exit: line.startsWith(failing) && failing ? 1 : 0 };
    },
  };
  return { session, calls };
}

async function open(session: SessionLike) {
  let closed = 0;
  h = await renderTui(
    <ThemeProvider><KeyRouter onQuit={() => {}}><Palette session={session} registry={registry} onClose={() => closed++} /></KeyRouter></ThemeProvider>,
  );
  return { closes: () => closed };
}

test("search ranks prefix before contains and marks destructive; scopes @ and !", () => {
  const keys = (q: string) => search(registry, q).map((x) => x.key);
  const r = keys("fix");
  expect(r.every((k) => k.includes("fix"))).toBe(true);
  expect(search(registry, "wip")[0]).toMatchObject({ key: "demo wipe", destructive: true });
  expect(search(registry, "demo")[0]!.range).toEqual([0, 4]);
  expect(keys("@cap").every((k) => k.startsWith("cap-fixture"))).toBe(true);
  expect(keys("!")).toEqual(["demo wipe"]);
  expect(keys("#x")).toEqual([]);
  expect(search(registry, "demo")[0]!.origin).toBe("usermodule");
});

test("typing a query shows ranked results with the destructive mark", async () => {
  await open(fake().session);
  await h!.type(">wipe");
  const f = h!.frame();
  expect(f).toContain("demo wipe !");
  expect(f).not.toContain("demo greet");
});

test("queue runs in order and stops at the first failure; favorites persist", async () => {
  const ok = fake();
  const o = await open(ok.session);
  await h!.type("@cap");
  await h!.press(" ");
  await h!.press("ARROW_DOWN");
  await h!.press(" ");
  expect(h!.frame()).toContain("fila (2)");
  await h!.press("\x1b[13;5u"); // ctrl+enter as the kitty protocol sends it
  await h!.flush();
  expect(ok.calls.map((c) => c.line)).toEqual(["cap-fixture fix-a", "cap-fixture fix-b"]);
  expect(o.closes()).toBe(1);
  h?.destroy();

  const bad = fake("cap-fixture fix-a");
  await open(bad.session);
  await h!.type("@cap");
  await h!.press(" ");
  await h!.press("ARROW_DOWN");
  await h!.press(" ");
  await h!.press("\x1b[13;5u"); // ctrl+enter as the kitty protocol sends it
  await h!.flush();
  expect(bad.calls.map((c) => c.line)).toEqual(["cap-fixture fix-a"]);

  h?.destroy();
  await open(fake().session);
  await h!.type("@cap");
  await h!.press("f", { ctrl: true });
  expect(loadFavorites()).toEqual(["cap-fixture fix-a"]);
  await h!.press("f", { ctrl: true });
  expect(loadFavorites()).toEqual([]);
});

test("form shows required *, masks the secret and keeps it out of the line and the history line", async () => {
  const { session, calls } = fake();
  await open(session);
  await h!.type(">login");
  await h!.press("TAB");
  await h!.type("s3cr3t");
  const f = h!.frame();
  expect(f).toContain("token*");
  expect(f).toContain("●●●●●●");
  expect(f).not.toContain("s3cr3t");
  expect(f).toContain("$ pvx demo login");
  await h!.press("RETURN");
  await h!.flush();
  expect(calls).toEqual([{ line: "demo login", secrets: { token: "s3cr3t" } }]);

  const b = buildLine("demo login", registry.commands.get("demo login")!.args, { token: "s3cr3t" });
  expect(b.argv.join(" ") + b.display).not.toContain("s3cr3t");
});
