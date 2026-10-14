import { EXIT, type ArgSpec } from "@pvx/sdk";
import { addIgnore, lineOf } from "../journal/index.ts";
import { parseArgs } from "../engine/args.ts";
import { execute } from "../engine/execute.ts";
import { resolveCommand } from "../engine/registry.ts";
import type { CoreCommand } from "./core.ts";
import type { Output } from "./run.ts";

const usageError = (o: Output, text: string) => (o.line({ kind: "error", text }), EXIT.USAGE);

const ignorarArgs: ArgSpec[] = [
  { name: "capacidade", help: "Id da capacidade pendente", kind: "positional", required: true },
  { name: "motivo", help: "Por que ignorar (vira nota ligada à capacidade)", kind: "option", required: true },
];
export const IGNORE_COMMANDS: CoreCommand[] = [
  {
    key: "conformidade ignorar",
    help: "Ignora uma pendência por 24 h, com motivo (vira nota)",
    root: true,
    args: ignorarArgs,
    async run({ io, o, rest }) {
      const p = await parseArgs(ignorarArgs, rest, { env: io.env });
      if (!p.ok) return usageError(o, p.message);
      const id = String(p.args.capacidade);
      const reason = String(p.args.motivo).trim();
      if (!io.registry.capabilities.some((c) => c.id === id)) return usageError(o, `capacidade desconhecida: \`${id}\``);
      if (!reason) return usageError(o, "o motivo não pode ser vazio");
      const ig = addIgnore(id, reason);
      o.line({ kind: "success", text: `${id} ignorada até ${new Date(ig.until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` });
      // The note goes through the normal command path (log, audit, scrollback), by the command a module declared as role `addNote`.
      // Without one the reason stays here.
      const addNote = io.registry.roles.get("addNote")?.name.split(" ") ?? [];
      const argv = [...addNote, "--tag", "ignorado", "--ref", `cap:${id}`, reason];
      if (!addNote.length || !resolveCommand(io.registry, argv)) o.line({ kind: "warning", text: "módulo de notas não carregado: o motivo ficou só no registro de ignorados" });
      else {
        const r = await execute(io.registry, argv, { makeLogger: io.makeLogger, confirmed: true, isRoot: io.isRoot, env: io.env });
        if (!r.ok) o.line({ kind: "warning", text: `a nota não foi criada (${r.lines.find((l) => l.kind === "error")?.text ?? `exit ${r.exit}`}); o motivo ficou no registro de ignorados` });
        else o.line({ kind: "info", text: `nota criada: ${lineOf(addNote)} --ref cap:${id}` });
      }
      return EXIT.OK;
    },
  },
];
