import { beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome, runCli, type Registry } from "../packages/core/src/index.ts";
import { theme } from "../packages/tui/src/index.ts";
import { builtin } from "../packages/builtin/index.ts";
import { openNotes, parseEvents } from "../packages/builtin/notas/src/notes.ts";

let registry: Registry;
beforeEach(async () => {
  registry = createRegistry();
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger: (n) => createLogger(logsDir(), n), builtin });
});

const file = () => join(pvxHome(), "notes.jsonl");
const events = () => parseEvents(readFileSync(file(), "utf8"));
const notes = () => openNotes(events());
/** In-process CLI. `user` is the SUDO_USER of the call; `stdin` pipes text in (no TTY); `yes` answers the question of a destructive command. */
async function nota(argv: string[], o: { user?: string; root?: boolean; stdin?: string; yes?: boolean } = {}) {
  const out: string[] = [];
  const env = { NO_COLOR: "1", SUDO_USER: o.user ?? "ana" };
  Object.assign(process.env, env); // the module reads SUDO_USER like the real binary does
  const exit = await runCli({
    argv: ["nota", ...argv, ...(o.yes ? ["--yes"] : [])], env, isTTY: false, isRoot: o.root ?? true, registry, makeLogger: (n) => createLogger(logsDir(), n),
    profilesDir: "", version: "0.1.0", theme, out: (l) => void out.push(l), readStdin: async () => o.stdin ?? "",
  });
  return { exit, out: out.join("\n") };
}
/** A note as pvx 1 wrote it: with the system user as author, tags, pin and login. */
const legacy = (event: object) => (mkdirSync(pvxHome(), { recursive: true }), appendFileSync(file(), `${JSON.stringify({ v: 1, at: new Date().toISOString(), ...event })}\n`));

test("two processes append 100 notes each at once: all 200 lines are there and parse", async () => {
  const run = (tag: string) => Bun.spawn(["bun", join(import.meta.dir, "helpers/notas-writer.ts"), tag, "100"], { env: { ...process.env, SUDO_USER: tag }, stdout: "inherit", stderr: "inherit" });
  const codes = await Promise.all([run("a").exited, run("b").exited]);
  expect(codes).toEqual([0, 0]);
  const lines = readFileSync(file(), "utf8").split("\n").filter(Boolean);
  expect(lines).toHaveLength(200);
  expect(lines.map((l) => JSON.parse(l).ev)).toEqual(Array(200).fill("add"));
  expect(openNotes(parseEvents(lines.join("\n")))).toHaveLength(200);
}, 60_000);

test("the file is append-only with mode 0644 and each event follows the schema", async () => {
  const r = await nota(["add", "trunk novo", "--assinatura", "Ana S."]);
  expect(r.exit).toBe(0);
  expect(r.out).toContain("nota 1 criada");
  expect(statSync(file()).mode & 0o777).toBe(0o644);
  const [add] = events();
  expect(add).toMatchObject({ v: 2, ev: "add", author: "ana", text: "trunk novo", signature: "Ana S." });
  expect(add!.id).toMatch(/^[0-9a-f]{6}$/);
  expect(new Date(add!.at).toISOString()).toBe(add!.at);
});

test("the signature is optional: a note without one has none, and the CLI does not take the old flags", async () => {
  await nota(["add", "sem assinatura"]);
  expect(notes()[0]!.signature).toBeUndefined();
  expect((await nota(["add", "x", "--tag", "sip"])).exit).toBe(2);
  expect((await nota(["add", "x", "--fixar"])).exit).toBe(2);
  expect((await nota(["add", "x", "--assinatura", "a".repeat(61)])).exit).toBe(1);
  expect(events()).toHaveLength(1);
});

test("stdin: `echo txt | nota add`; an empty text is a usage error", async () => {
  const r = await nota(["add"], { stdin: "texto longo\nem duas linhas\n" });
  expect(r.exit).toBe(0);
  expect(events()[0]!.text).toBe("texto longo\nem duas linhas");
  expect((await nota(["add"], { stdin: "" })).exit).toBe(2);
  expect((await nota(["add", ""])).exit).toBe(2);
  expect(events()).toHaveLength(1); // nothing was written by the failures
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
  legacy({ id: "abc123", ev: "add", author: "m\u001b[1mal", text: "\u001b[31mvermelho\u001b[0m \u001b]0;x\u0007ok" });
  const r = await nota(["list"], { user: "ana" });
  expect(r.out).not.toMatch(/[\u001b\u0007]/);
  expect(r.out).toContain("vermelho ok");
});

test("list: newest first, with the number, `dd/mm`, the text and `— signature`; nothing to list says so", async () => {
  expect((await nota(["list"])).out).toContain("nenhuma nota");
  await nota(["add", "primeira", "--assinatura", "Ana"]);
  await nota(["add", "segunda"]);
  const lines = (await nota(["list"])).out.split("\n");
  expect(lines[0]).toMatch(/^2  \d\d\/\d\d  segunda$/);
  expect(lines[1]).toMatch(/^1  \d\d\/\d\d  primeira  — Ana$/);
});

test("remove: asks first in the CLI, takes the note out of the list and keeps the other numbers", async () => {
  await nota(["add", "um"]);
  await nota(["add", "dois"]);
  await nota(["add", "tres"]);
  const refused = await nota(["remove", "2"]);
  expect(refused.exit).not.toBe(0); // destructive: without --yes there is no question to answer in a pipe
  expect(notes()).toHaveLength(3);
  const done = await nota(["remove", "2"], { yes: true });
  expect(done.exit).toBe(0);
  expect(done.out).toContain("nota 2 removida");
  expect(events().at(-1)).toMatchObject({ v: 2, ev: "remove", author: "ana", id: events()[1]!.id });
  expect(notes().map((n) => [n.n, n.text])).toEqual([[1, "um"], [3, "tres"]]);
  expect((await nota(["list"])).out).not.toContain("dois");
  await nota(["add", "quatro"]);
  expect(notes().map((n) => n.n)).toEqual([1, 3, 4]); // a number is never reused
});

test("remove: a number that is not one, or not there, is an error and writes nothing", async () => {
  await nota(["add", "um"]);
  for (const bad of ["0", "-1", "1.5", "abc", "7"]) {
    const r = await nota(["remove", bad], { yes: true });
    expect(r.exit, bad).toBe(1);
  }
  expect((await nota(["remove", "1"], { yes: true })).exit).toBe(0);
  expect((await nota(["remove", "1"], { yes: true })).exit).toBe(1); // already removed
  expect(events()).toHaveLength(2);
});

test("notes of the old format keep their text, date and author, as numbers in the order they were added", async () => {
  legacy({ id: "aaaaaa", ev: "add", author: "carlos", text: "token trocado", at: "2026-09-01T10:00:00.000Z", tags: ["sip"], login: true });
  legacy({ id: "aaaaaa", ev: "pin", author: "carlos" });
  legacy({ id: "bbbbbb", ev: "add", author: "ana", text: "antes", at: "2026-09-02T10:00:00.000Z" });
  legacy({ id: "bbbbbb", ev: "edit", author: "ana", text: "depois" });
  legacy({ id: "cccccc", ev: "add", author: "rafael", text: "resolvida" });
  legacy({ id: "cccccc", ev: "resolve", author: "rafael" });
  const open = notes();
  expect(open.map((n) => [n.n, n.text, n.signature, n.at])).toEqual([
    [1, "token trocado", "carlos", "2026-09-01T10:00:00.000Z"],
    [2, "depois", "ana", "2026-09-02T10:00:00.000Z"],
  ]);
  const listed = (await nota(["list"])).out.split("\n");
  expect(listed[0]).toMatch(/^2  02\/09  depois  — ana$/);
  expect(listed[1]).toMatch(/^1  01\/09  token trocado  — carlos$/);
  expect((await nota(["remove", "1"], { yes: true })).exit).toBe(0); // the old ids work through their number
  expect(notes().map((n) => n.text)).toEqual(["depois"]);
});

test("a damaged line is skipped, and the notes around it stay", async () => {
  await nota(["add", "antes"]);
  appendFileSync(file(), "{not json\n");
  await nota(["add", "depois"]);
  expect(notes().map((n) => n.text)).toEqual(["antes", "depois"]);
});

test("nota list works without root; writing commands say `rode com sudo`", async () => {
  await nota(["add", "uma"]);
  const l = await nota(["list"], { root: false });
  expect(l.exit).toBe(0);
  expect(l.out).toContain("uma");
  const a = await nota(["add", "outra"], { root: false });
  expect(a.exit).toBe(1);
  expect(a.out).toContain("rode com sudo");
  expect((await nota(["remove", "1"], { root: false, yes: true })).out).toContain("rode com sudo");
  expect(events()).toHaveLength(1);
});

test("the old commands are gone: fixar, desfixar, resolver, editar", async () => {
  for (const old of ["fixar", "desfixar", "resolver", "editar"]) expect((await nota([old, "1"])).exit, old).not.toBe(0);
  expect(registry.pages.has("nota.notas")).toBe(false);
});

test("the query the login banner reads and the roles of the module", async () => {
  await nota(["add", "antiga", "--assinatura", "Ana"]);
  await nota(["add", "nova"]);
  const state = (await registry.query("notas.state")) as { n: number; text: string; signature?: string }[];
  expect(state.map((n) => [n.n, n.text, n.signature])).toEqual([[2, "nova", undefined], [1, "antiga", "Ana"]]);
  expect([...registry.roles].map(([role, v]) => [role, v.name]).sort()).toEqual([["addNote", "nota add"], ["notesState", "notas.state"], ["removeNote", "nota remove"]]);
});

test("the module may only write its own file: other paths under PVX_HOME are denied", async () => {
  writeFileSync(join(pvxHome(), "x"), "");
  const fs = (await import("../packages/core/src/index.ts")).createGranted("nota", { fs: ["rw:$PVX_HOME/notes.jsonl"] }, createLogger(logsDir(), "nota"), createLogger(logsDir(), "core")).fs;
  await fs.append("$PVX_HOME/notes.jsonl", "x\n");
  await expect(fs.append(join(pvxHome(), "other.json"), "x")).rejects.toThrow(/permissão negada/);
});
