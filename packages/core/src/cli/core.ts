import { existsSync } from "node:fs";
import { EXIT, type ArgSpec, type OutLine } from "@pvx/sdk";
import { parseArgs } from "../engine/args.ts";
import { execute } from "../engine/execute.ts";
import { logsDir } from "../engine/paths.ts";
import { createStore } from "../engine/store.ts";
import { followLogs, readLogs } from "../logs/index.ts";
import { applyPlan, buildPlan, evaluate, loadProfiles, selectProfile, type EvalResult } from "../plan/index.ts";
import type { Entry } from "./help.ts";
import type { CliIO, Output } from "./run.ts";

interface Ctx {
  io: CliIO;
  o: Output;
  rest: string[];
  json: boolean;
  yes: boolean;
}
interface CoreCommand extends Entry {
  /** Writes to PVX_HOME: needs root. */
  root?: boolean;
  run(c: Ctx): Promise<number>;
}

const level = { ok: "success", warn: "warning", error: "error" } as const;
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
    help: "Lista módulos, versão e estado",
    async run({ io, o }) {
      const rows = [
        ...[...io.registry.modules.values()].map((m) => ({ id: m.id, line: { kind: "success", text: `${m.id} ${m.version} carregado` } as OutLine })),
        ...io.registry.errors.map((e) => ({ id: e.id, line: { kind: "warning", text: `${e.id} erro: ${e.error}` } as OutLine })),
      ].sort((a, b) => a.id.localeCompare(b.id));
      if (!rows.length) o.line({ kind: "info", text: "nenhum módulo instalado" });
      for (const r of rows) o.line(r.line);
      return EXIT.OK;
    },
  },
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
        for (const x of r.results) o.line({ kind: level[x.level], text: `${x.title}: ${x.text}`, fix: x.level === "ok" ? undefined : x.fix });
        const n = (l: string) => r.results.filter((x) => x.level === l).length;
        o.line({ kind: "info", text: `${n("ok")} ok, ${n("warn")} avisos, ${n("error")} erros` });
        return p.args.strict && n("ok") < r.results.length ? EXIT.ERROR : EXIT.OK;
      });
    },
  },
  {
    key: "plano",
    help: "Mostra os passos que levam a central ao perfil",
    run: ({ io, o }) =>
      withProfile(io, o, (r) => {
        const { steps, manual } = buildPlan(r.results);
        steps.forEach((s, i) => {
          const tags = [s.implicit && `implícito: ${s.reason}`, s.optIn && "opt-in"].filter(Boolean).join("; ");
          o.line({ kind: "plain", text: `${i + 1}. ${s.cmd}${tags ? ` (${tags})` : ""} para ${s.for.join(", ")}` });
        });
        for (const m of manual) o.line({ kind: "warning", text: `manual: ${m.title}: ${m.text}` });
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
        const plan = buildPlan(r.results);
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
