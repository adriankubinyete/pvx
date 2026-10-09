import { beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCli, type Registry } from "../packages/core/src/index.ts";
import { theme } from "../packages/tui/src/index.ts";
import { builtin } from "../packages/builtin/index.ts";
import { fold, parseEvents } from "../packages/builtin/notas/src/notes.ts";

let registry: Registry;
beforeEach(async () => {
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: (n) => createLogger(logsDir(), n), builtin });
});

const file = () => join(pvxHome(), "notes.jsonl");
const events = () => parseEvents(readFileSync(file(), "utf8"));
/** In-process CLI. `user` is the SUDO_USER of the call; `stdin` pipes text in (no TTY). */
async function nota(argv: string[], o: { user?: string; root?: boolean; stdin?: string } = {}) {
  const out: string[] = [];
  const env = { NO_COLOR: "1", SUDO_USER: o.user ?? "ana" };
  Object.assign(process.env, env); // the module reads SUDO_USER like the real binary does
  const exit = await runCli({
    argv: ["nota", ...argv], env, isTTY: false, isRoot: o.root ?? true, registry, makeLogger: (n) => createLogger(logsDir(), n),
    profilesDir: "", version: "0.1.0", theme, out: (l) => void out.push(l), readStdin: async () => o.stdin ?? "",
  });
  return { exit, out: out.join("\n") };
}
const idOf = (out: string) => /nota (\w{6}) criada/.exec(out)![1]!;

test("two processes append 100 notes each at once: all 200 lines are there and parse", async () => {
  const run = (tag: string) => Bun.spawn(["bun", join(import.meta.dir, "helpers/notas-writer.ts"), tag, "100"], { env: { ...process.env, SUDO_USER: tag }, stdout: "inherit", stderr: "inherit" });
  const codes = await Promise.all([run("a").exited, run("b").exited]);
  expect(codes).toEqual([0, 0]);
  const lines = readFileSync(file(), "utf8").split("\n").filter(Boolean);
  expect(lines).toHaveLength(200);
  expect(lines.map((l) => JSON.parse(l).ev)).toEqual(Array(200).fill("add"));
  expect(fold(parseEvents(lines.join("\n")))).toHaveLength(200);
}, 60_000);

test("the file is append-only with mode 0644 and each event follows the schema", async () => {
  const r = await nota(["add", "--tag", "sip", "--tag", "backup", "--login", "--fixar", "trunk", "novo"]);
  expect(r.exit).toBe(0);
  expect(statSync(file()).mode & 0o777).toBe(0o644);
  const [add, pin] = events();
  expect(add).toMatchObject({ v: 1, ev: "add", author: "ana", text: "trunk novo", tags: ["sip", "backup"], login: true });
  expect(add!.id).toMatch(/^[0-9a-f]{6}$/);
  expect(new Date(add!.at).toISOString()).toBe(add!.at);
  expect(pin).toMatchObject({ ev: "pin", id: add!.id });
});

test("stdin: `echo txt | nota add` and the same for editar; an empty text is a usage error", async () => {
  const r = await nota(["add", "--tag", "sip"], { stdin: "texto longo\nem duas linhas\n" });
  expect(r.exit).toBe(0);
  expect(events()[0]!.text).toBe("texto longo\nem duas linhas");
  const e = await nota(["editar", idOf(r.out)], { stdin: "novo texto" });
  expect(e.exit).toBe(0);
  expect(fold(events())[0]!.text).toBe("novo texto");
  expect((await nota(["add"], { stdin: "" })).exit).toBe(2);
  expect((await nota(["add", ""])).exit).toBe(2);
  expect(events()).toHaveLength(2); // nothing was written by the failures
});

test("the 8 KB limit is enforced in bytes", async () => {
  expect((await nota(["add", "é".repeat(4097)])).exit).toBe(1); // 8194 bytes
  expect(existsSync(file())).toBe(false);
  expect((await nota(["add", "é".repeat(4096)])).exit).toBe(0); // exactly 8192
});

test("control and ANSI characters are stripped on write", async () => {
  const r = await nota(["add", "a\u001b[31mred\u001b[0m\u0007 \u001b]0;title\u0007b\u0000c"]);
  expect(events()[0]!.text).toBe("ared bc");
  expect(r.exit).toBe(0);
});

test("a note written with ANSI behind our back is inert in the CLI output", async () => {
  mkdirSync(pvxHome(), { recursive: true });
  appendFileSync(file(), `${JSON.stringify({ v: 1, id: "abc123", at: new Date().toISOString(), ev: "add", author: "m\u001b[1mal", text: "\u001b[31mvermelho\u001b[0m \u001b]0;x\u0007ok", tags: ["t\u001b[2J"] })}\n`);
  const r = await nota(["list"], { user: "ana" });
  expect(r.out).not.toMatch(/[\u001b\u0007]/);
  expect(r.out).toContain("vermelho ok");
});

test("the fold handles edit, pin, unpin and resolve; a damaged line is skipped", async () => {
  const id = idOf((await nota(["add", "um"])).out);
  await nota(["fixar", id]);
  expect(fold(events())[0]).toMatchObject({ pinned: true, text: "um" });
  await nota(["editar", id.slice(0, 3), "dois", "--tag", "x"]);
  await nota(["desfixar", id]);
  expect(fold(events())[0]).toMatchObject({ pinned: false, text: "dois", tags: ["x"], resolved: false });
  appendFileSync(file(), "{not json\n");
  await nota(["resolver", id]);
  const [n] = fold(events());
  expect(n).toMatchObject({ resolved: true, author: "ana" });
  expect((await nota(["list"])).out).toContain("nenhuma nota");
  expect((await nota(["fixar", id])).exit).toBe(1); // resolved
  expect((await nota(["fixar", "zzzzzz"])).exit).toBe(1);
});

test("new is per user: what ana has seen is still new for rafael", async () => {
  await nota(["add", "do carlos"], { user: "carlos" });
  const a1 = await nota(["list", "--novas"], { user: "ana" });
  expect(a1.out).toContain("do carlos");
  expect(a1.out).toContain("●");
  expect((await nota(["list", "--novas"], { user: "ana" })).out).toContain("nenhuma nota"); // list moved ana's marker
  const r = await nota(["list", "--novas"], { user: "rafael" });
  expect(r.out).toContain("do carlos");
  expect(existsSync(join(pvxHome(), "seen", "ana.json"))).toBe(true);
  expect(existsSync(join(pvxHome(), "seen", "rafael.json"))).toBe(true);
  // an event by the author themselves is never new for them
  await nota(["add", "da ana"], { user: "ana" });
  expect((await nota(["list", "--novas", "--minhas"], { user: "ana" })).out).toContain("nenhuma nota");
});

test("nota list works without root; writing commands say `rode com sudo`", async () => {
  await nota(["add", "uma"]);
  const l = await nota(["list"], { root: false });
  expect(l.exit).toBe(0);
  expect(l.out).toContain("uma");
  const a = await nota(["add", "outra"], { root: false });
  expect(a.exit).toBe(1);
  expect(a.out).toContain("rode com sudo");
  expect(events()).toHaveLength(1);
  for (const c of [["fixar", "x"], ["desfixar", "x"], ["resolver", "x"], ["editar", "x", "y"]]) expect((await nota(c, { root: false })).out).toContain("rode com sudo");
});

test("filters, nickname from people.json and --apelido", async () => {
  await nota(["add", "--tag", "sip", "--fixar", "fixada sip"], { user: "ana" });
  await nota(["add", "--tag", "backup", "solta backup", "--apelido", "Carlão"], { user: "carlos" });
  expect(JSON.parse(readFileSync(join(pvxHome(), "people.json"), "utf8"))).toEqual({ carlos: "Carlão" });
  const all = (await nota(["list"], { user: "ana" })).out;
  expect(all.indexOf("fixada sip")).toBeLessThan(all.indexOf("solta backup")); // pinned first
  expect(all).toContain("Carlão"); // the nickname is shown, the user is stored
  expect(events().at(-1)!.author).toBe("carlos");
  expect((await nota(["list", "--fixadas"])).out).not.toContain("solta backup");
  expect((await nota(["list", "--tag", "#backup"])).out).not.toContain("fixada sip");
  expect((await nota(["list", "--minhas"], { user: "carlos" })).out).not.toContain("fixada sip");
});

test("queries: since returns the events after the instant; state returns the fold", async () => {
  await nota(["add", "antiga"]);
  const t = new Date().toISOString();
  await Bun.sleep(5);
  await nota(["add", "nova", "--fixar"]);
  const since = (await registry.query("notas.since", t)) as { ev: string; text?: string }[];
  expect(since.map((e) => e.ev)).toEqual(["add", "pin"]);
  expect(since[0]!.text).toBe("nova");
  const state = (await registry.query("notas.state")) as { text: string; pinned: boolean }[];
  expect(state.map((n) => [n.text, n.pinned])).toEqual([["antiga", false], ["nova", true]]);
});

test("the module may only write its own files: other paths under PVX_HOME are denied", async () => {
  writeFileSync(join(pvxHome(), "x"), "");
  const fs = (await import("../packages/core/src/index.ts")).createGranted("nota", { fs: ["rw:$PVX_HOME/notes.jsonl"] }, createLogger(logsDir(), "nota"), createLogger(logsDir(), "core")).fs;
  await fs.append("$PVX_HOME/notes.jsonl", "x\n");
  await expect(fs.append(join(pvxHome(), "other.json"), "x")).rejects.toThrow(/permissão negada/);
});
