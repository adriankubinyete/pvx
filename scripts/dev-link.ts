// Dev tooling, not the pvx binary: registers a local module checkout in the PVX_HOME that `bun dev` uses.
// It reuses the core link logic, so the registration format is the one `pvx modules link` writes. The binary keeps its root rule.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { devLinks, linkModule, removeModule, type Result } from "@pvx/core";

const DEV_HOME = ".dev/pvx";

export function listLinked(): string[] {
  const links = devLinks();
  if (!links.length) return ["nenhum módulo linkado"];
  return links.map((link) => `${link.id} -> ${link.path}`);
}

function describe(result: Result): string {
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

export function link(path: string): string[] {
  const result = linkModule(path);
  const text = describe(result);
  const target = realpathSync(path);
  return [text, `id: ${result.id}`, `path: ${target}`];
}

export function unlink(id: string): string[] {
  return [describe(removeModule(id))];
}

export function runDevLink(mode: "link" | "unlink", argument?: string): string[] {
  if (mode === "unlink") {
    if (!argument) throw new Error("uso: bun run dev:unlink <id>");
    return unlink(argument);
  }
  if (!argument) return listLinked();
  return link(argument);
}

function main(): void {
  process.env.PVX_HOME = resolve(import.meta.dir, "..", DEV_HOME);
  const mode = process.argv[2] === "unlink" ? "unlink" : "link";
  try {
    console.log(runDevLink(mode, process.argv[3]).join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

if (import.meta.main) main();
