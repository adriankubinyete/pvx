import { EXIT, type ArgSpec } from "@pvx/sdk";
import { parseArgs } from "../engine/args.ts";
import { logsDir } from "../engine/paths.ts";
import { followLogs, readLogs } from "../logs/index.ts";
import { catalogOf, pathHelp, rootHelp, type Entry } from "./help.ts";
import { catalogSearchCommand } from "../catalog/search-command.ts";
import { BANNER_COMMAND } from "./banner.ts";
import { SELF_COMMANDS } from "./self.ts";
import { JOBS_COMMANDS } from "./jobs.ts";
import { listCommand, MODULES_COMMANDS } from "./modules.ts";
import { embeddedText, versionInfo } from "../modules/embedded.ts";
import type { CliIO, Output } from "./run.ts";

export interface Ctx {
  io: CliIO;
  o: Output;
  rest: string[];
  json: boolean;
  yes: boolean;
}
export interface CoreCommand extends Entry {
  /** Writes to PVX_HOME: needs root. */
  root?: boolean;
  /** Skips the audit line (the command removes the file it would write to). */
  noAudit?: boolean;
  run(c: Ctx): Promise<number>;
}

const logsArgs: ArgSpec[] = [
  { name: "module", help: "Módulo (sem módulo e sem --all: core)", kind: "positional" },
  { name: "tail", help: "Últimas N entradas (padrão 50)", kind: "option" },
  { name: "follow", help: "Segue o log até Ctrl+C (-f)", kind: "flag" },
  { name: "all", help: "Mescla os logs de todos os módulos", kind: "flag" },
];

export const CORE: CoreCommand[] = [
  {
    key: "modules",
    help: "Lista módulos, versão e estado (subcomandos: add, list, update, link, remove, enable, disable, trust)",
    run: listCommand,
  },
  catalogSearchCommand,
  {
    key: "logs",
    help: "Mostra os logs, mesclados por horário",
    args: logsArgs,
    async run({ io, o, rest, json }) {
      const p = await parseArgs(logsArgs, rest.map((a) => (a === "-f" ? "--follow" : a)), { env: io.env });
      if (!p.ok) return usageError(o, p.message);
      const tail = p.args.tail === undefined ? 50 : Number(p.args.tail);
      if (!Number.isInteger(tail) || tail < 0) return usageError(o, "`--tail` pede um número inteiro");
      if (p.args.follow && json) return usageError(o, "`-f` não combina com `--json`");
      const mod = String(p.args.module ?? "core");
      if (!p.args.all && !/^[a-z0-9-]+$/.test(mod)) return usageError(o, `módulo inválido: \`${mod}\``);
      const q = { logsDir: logsDir(), modules: p.args.all ? ("all" as const) : [mod], tail };
      for (const l of readLogs(q)) o.line({ kind: "plain", text: l });
      if (p.args.follow) await followLogs(q, (l) => o.line({ kind: "plain", text: l }), io.signal ?? new AbortController().signal);
      return EXIT.OK;
    },
  },
  BANNER_COMMAND,
  ...MODULES_COMMANDS,
  ...SELF_COMMANDS,
  ...JOBS_COMMANDS,
  {
    key: "help",
    help: "Lista os comandos; `help <módulo> [comando]` detalha (atalho: h)",
    async run({ io, o, rest }) {
      const lines = rest.length ? pathHelp(catalogOf(CORE, io.registry), rest) : rootHelp(io.version, CORE, io.registry);
      if (!lines) return o.line({ kind: "error", text: `comando não encontrado: ${rest.join(" ")}` }), EXIT.NOT_FOUND;
      lines.forEach((text) => o.line({ kind: "plain", text }));
      return EXIT.OK;
    },
  },
  {
    key: "version",
    help: "Mostra a versão",
    async run({ io, o }) {
      const info = versionInfo(io.version, io.build, io.registry.embedded.values());
      o.line({ kind: "plain", text: `pvx ${io.version}`, build: info });
      for (const embedded of info.embedded) o.line({ kind: "plain", text: `embutido (dev): ${embeddedText(embedded)}` });
      return EXIT.OK;
    },
  },
];

/** Words a module id cannot take: the first word of every core command, plus the `h` alias of `help`. */
export const RESERVED = [...new Set([...CORE.map((c) => c.key.split(" ")[0]!), "h"])];

function usageError(o: Output, text: string): number {
  o.line({ kind: "error", text });
  return EXIT.USAGE;
}
