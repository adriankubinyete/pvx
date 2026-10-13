import { existsSync } from "node:fs";
import { EXIT, type ArgSpec } from "@pvx/sdk";
import { parseArgs } from "../engine/args.ts";
import { execute } from "../engine/execute.ts";
import { logsDir } from "../engine/paths.ts";
import { createStore } from "../engine/store.ts";
import { followLogs, readLogs } from "../logs/index.ts";
import { applyPlan, buildPlan, evaluate, loadProfiles, selectProfile, type EvalResult } from "../plan/index.ts";
import type { Entry } from "./help.ts";
import { recordDrift, recordSnapshot, partitionIgnored } from "../journal/index.ts";
import { IGNORE_COMMANDS } from "./ignorar.ts";
import { catalogSearchCommand } from "../catalog/search-command.ts";
import { BANNER_COMMAND } from "./banner.ts";
import { SELF_COMMANDS } from "./self.ts";
import { listCommand, MODULES_COMMANDS } from "./modules.ts";
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

const level = { ok: "success", warn: "warning", error: "error" } as const;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const NO_PROFILE = "nenhum perfil aplicável (PVX_PROFILE força um)";

/** Runs `fn` with the evaluated profile; a bad PVX_PROFILE is a usage error, no profile is a warning. */
async function withProfile(io: CliIO, o: Output, fn: (r: { title: string; results: EvalResult[] }) => Promise<number> | number): Promise<number> {
  let r;
  try {
    r = await profileResults(io);
  } catch (e) {
    return usageError(o, (e as Error).message);
  }
  if (!r) return o.line({ kind: "warning", text: NO_PROFILE }), EXIT.OK;
  return fn(r);
}

async function profileResults(io: CliIO): Promise<{ title: string; results: EvalResult[] } | null> {
  const profile = selectProfile(await loadProfiles(io.profilesDir), io.env, existsSync);
  if (!profile) return null;
  const caps = new Map(io.registry.capabilities.map((c) => [c.id, c]));
  const results = await evaluate(profile, caps, (c) => {
    const m = caps.get(c.id)!.moduleId;
    return { log: io.makeLogger(m), store: createStore(m), query: io.registry.query };
  });
  recordDrift(results); // every evaluation (CLI or TUI refresh) appends the level changes
  recordSnapshot(profile.title, results); // and leaves the result the login banner shows
  return { title: profile.title, results };
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
  {
    key: "conformidade",
    help: "Avalia a central contra o perfil aplicável",
    args: [{ name: "strict", help: "Sai com 1 se houver pendência", kind: "flag" }],
    async run({ io, o, rest }) {
      const p = await parseArgs(this.args, rest, { env: io.env });
      if (!p.ok) return usageError(o, p.message);
      return withProfile(io, o, (r) => {
        o.line({ kind: "info", text: `perfil: ${r.title}` });
        const { ignored } = partitionIgnored(r.results);
        const skip = new Set(ignored.map((x) => x.id));
        for (const x of r.results) {
          const ig = ignored.find((i) => i.id === x.id);
          if (ig) o.line({ kind: "info", text: `${x.title}: ${x.text} (ignorado até ${hhmm(ig.until)})`, ignored: ig.until });
          else o.line({ kind: level[x.level], text: `${x.title}: ${x.text}`, fix: x.level === "ok" ? undefined : x.fix });
        }
        const live = r.results.filter((x) => !skip.has(x.id));
        const n = (l: string) => live.filter((x) => x.level === l).length;
        o.line({ kind: "info", text: `${n("ok")} ok, ${n("warn")} avisos, ${n("error")} erros${ignored.length ? `, ${ignored.length} ignorado(s)` : ""}` });
        return p.args.strict && n("ok") < live.length ? EXIT.ERROR : EXIT.OK;
      });
    },
  },
  {
    key: "plano",
    help: "Mostra os passos que levam a central ao perfil",
    run: ({ io, o }) =>
      withProfile(io, o, (r) => {
        const { live, ignored } = partitionIgnored(r.results);
        const { steps, manual } = buildPlan(live);
        steps.forEach((s, i) => {
          const tags = [s.implicit && `implícito: ${s.reason}`, s.optIn && "opt-in"].filter(Boolean).join("; ");
          o.line({ kind: "plain", text: `${i + 1}. ${s.cmd}${tags ? ` (${tags})` : ""} para ${s.for.join(", ")}`, step: s });
        });
        for (const m of manual) o.line({ kind: "warning", text: `manual: ${m.title}: ${m.text}` });
        for (const x of ignored) o.line({ kind: "info", text: `ignorado até ${hhmm(x.until)}: ${x.title}` });
        if (!steps.length && !manual.length) o.line({ kind: "success", text: "nada a fazer" });
        return EXIT.OK;
      }),
  },
  {
    key: "plano apply",
    help: "Aplica o plano; para no primeiro erro",
    root: true,
    async run({ io, o, yes }) {
      if (!yes && !(io.isTTY && io.ask)) return usageError(o, "fora de um terminal, `plano apply` exige --yes");
      return withProfile(io, o, async (r) => {
        const plan = buildPlan(partitionIgnored(r.results).live);
        const confirm = yes
          ? undefined
          : async (s: { cmd: string }) => {
              const a = (await io.ask!(`aplicar \`${s.cmd}\`? [s] aplica, [p] pula, [n] para: `)).trim().toLowerCase();
              return a === "s" || a === "y" ? ("yes" as const) : a === "p" ? ("skip" as const) : ("stop" as const);
            };
        const done = await applyPlan(
          plan,
          async (s) => {
            o.line({ kind: "plain", text: `❯ ${s.cmd}` });
            const res = await execute(io.registry, s.cmd, { makeLogger: io.makeLogger, confirmed: true, env: io.env, readStdin: io.readStdin, promptSecret: io.isTTY ? io.askSecret : undefined });
            res.lines.forEach((l) => o.line(l));
            return res.exit;
          },
          confirm,
        );
        const failed = done.find((d) => d.status === "error");
        const ok = done.filter((d) => d.status === "ok").length;
        if (failed) o.line({ kind: "error", text: `parou em \`${failed.step.cmd}\` (exit ${failed.code}); ${ok} passo(s) aplicado(s)` });
        else o.line({ kind: "success", text: `${ok} passo(s) aplicado(s), ${done.length - ok} pulado(s) ou não executado(s)` });
        return failed ? EXIT.ERROR : EXIT.OK;
      });
    },
  },
  BANNER_COMMAND,
  ...IGNORE_COMMANDS,
  ...MODULES_COMMANDS,
  ...SELF_COMMANDS,
  {
    key: "version",
    help: "Mostra a versão",
    async run({ io, o }) {
      o.line({ kind: "plain", text: `pvx ${io.version}` });
      return EXIT.OK;
    },
  },
];

function usageError(o: Output, text: string): number {
  o.line({ kind: "error", text });
  return EXIT.USAGE;
}
