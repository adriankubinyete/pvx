import type { ArgSpec } from "@pvx/sdk";
import type { Registry } from "../engine/registry.ts";

export interface Entry {
  key: string;
  help: string;
  args?: ArgSpec[];
  destructive?: boolean;
}

function usage(e: Entry): string {
  const parts = (e.args ?? []).map((a) => {
    if (a.kind === "positional") return a.secret ? "" : a.required ? `<${a.name}>` : `[${a.name}]`;
    const body = a.secret ? `--${a.name}-stdin` : a.kind === "flag" ? `--${a.name}` : `--${a.name} <valor>`;
    return a.required ? body : `[${body}]`;
  });
  return ["pvx", e.key, ...parts].filter(Boolean).join(" ");
}

const list = (entries: Entry[]): string[] => {
  const w = Math.max(0, ...entries.map((e) => e.key.length));
  return entries.map((e) => `  ${e.destructive ? "!" : " "} ${e.key.padEnd(w)}  ${e.help}`);
};

function detail(e: Entry): string[] {
  const out = [`uso: ${usage(e)}`, "", e.help];
  if (e.destructive) out.push("", "! destrutivo: exige --yes fora de um terminal");
  const args = e.args ?? [];
  if (args.length) {
    out.push("", "Argumentos:");
    const w = Math.max(...args.map((a) => a.name.length));
    for (const a of args) {
      const note = [a.required && "obrigatório", a.secret && "segredo: PVX_SECRET_* ou --nome-stdin"].filter(Boolean).join("; ");
      out.push(`  ${a.name.padEnd(w)}  ${a.help}${note ? ` (${note})` : ""}`);
    }
  }
  return out;
}

/** Core commands plus every module command: what `pathHelp` searches. */
export const catalogOf = (core: Entry[], registry: Registry): Entry[] => [
  ...core,
  ...[...registry.commands].map(([key, c]) => ({ key, help: c.help, args: c.args, destructive: c.destructive })),
];

/** Help for a path (module or command). `lines: null` = nothing matches (exit 3). */
export function pathHelp(catalog: Entry[], path: string[]): string[] | null {
  const key = path.join(" ");
  const exact = catalog.find((e) => e.key === key);
  const sub = catalog.filter((e) => e.key.startsWith(`${key} `));
  if (!exact && !sub.length) return null;
  return [...(exact ? detail(exact) : []), ...(sub.length ? [...(exact ? [""] : []), "Comandos:", ...list(sub)] : [])];
}

export function rootHelp(version: string, core: Entry[], registry: Registry): string[] {
  const out = [
    `pvx ${version}`,
    "uso: pvx <comando> [args] [--json] [--yes] [--help]",
    "",
    "Opções globais:",
    "  --json      saída em JSON: {ok, exit, lines}",
    "  --yes       confirma comandos destrutivos e `plano apply`",
    "  -h, --help  esta ajuda",
    "",
    "Núcleo:",
    ...list(core),
  ];
  for (const id of registry.modules.keys()) {
    const cmds = [...registry.commands].filter(([, c]) => c.moduleId === id).map(([key, c]) => ({ key, help: c.help, destructive: c.destructive }));
    out.push("", `Módulo ${id}:`, ...(cmds.length ? list(cmds) : ["  (sem comandos)"]));
  }
  if (registry.errors.length) out.push("", "Módulos com erro (veja `pvx modules`):", ...registry.errors.map((e) => `  ${e.id}`));
  out.push("", "`!` marca comando destrutivo.");
  return out;
}
