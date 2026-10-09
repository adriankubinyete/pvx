import { EXIT, type ArgSpec } from "@pvx/sdk";
import { addIgnore, diary, KINDS, lineOf, parseSince, type DiaryEntry, type Kind } from "../diary/index.ts";
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
const diarioArgs: ArgSpec[] = [
  { name: "desde", help: "Janela: 24h, 7d ou data ISO", kind: "option" },
  { name: "tipo", help: `Tipos, separados por vírgula: ${KINDS.join(", ")}`, kind: "option", values: [...KINDS] },
  { name: "busca", help: "Texto no registro ou no autor", kind: "option" },
];

const when = (at: string) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const entryText = (e: DiaryEntry) => `${when(e.at)}  ${e.kind.padEnd(6)} ${(e.user ?? "").padEnd(10)} ${e.text}${e.kind === "cmd" && e.data.exit ? ` (exit ${e.data.exit})` : ""}`;

export const DIARY_COMMANDS: CoreCommand[] = [
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
      // The note goes through the normal command path (log, audit, scrollback). Without the notas module the reason stays here.
      const argv = ["nota", "add", "--tag", "ignorado", "--ref", `cap:${id}`, reason];
      if (!resolveCommand(io.registry, argv)) o.line({ kind: "warning", text: "módulo de notas não carregado: o motivo ficou só no registro de ignorados" });
      else {
        const r = await execute(io.registry, argv, { makeLogger: io.makeLogger, confirmed: true, env: io.env });
        if (!r.ok) o.line({ kind: "warning", text: `a nota não foi criada (${r.lines.find((l) => l.kind === "error")?.text ?? `exit ${r.exit}`}); o motivo ficou no registro de ignorados` });
        else o.line({ kind: "info", text: `nota criada: ${lineOf(argv.slice(0, 2))} --ref cap:${id}` });
      }
      return EXIT.OK;
    },
  },
  {
    key: "diario",
    help: "Mostra o diário da central: notas, comandos, conformidade, logins e módulos, do mais novo ao mais velho",
    args: diarioArgs,
    async run({ io, o, rest }) {
      const p = await parseArgs(diarioArgs, rest, { env: io.env });
      if (!p.ok) return usageError(o, p.message);
      const kinds = p.args.tipo ? String(p.args.tipo).split(",").map((k) => k.trim()).filter(Boolean) : undefined;
      const bad = kinds?.find((k) => !(KINDS as readonly string[]).includes(k));
      if (bad) return usageError(o, `tipo desconhecido: \`${bad}\` (${KINDS.join(", ")})`);
      let since: number | undefined;
      try {
        since = p.args.desde ? parseSince(String(p.args.desde)) : undefined;
      } catch (e) {
        return usageError(o, (e as Error).message);
      }
      const entries = diary.query({ since, kinds: kinds as Kind[] | undefined, text: p.args.busca ? String(p.args.busca) : undefined });
      if (!entries.length) o.line({ kind: "info", text: "nada no diário para esse filtro" });
      for (const e of entries) o.line({ kind: "plain", text: entryText(e), entry: e });
      return EXIT.OK;
    },
  },
];
