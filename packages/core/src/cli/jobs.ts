import { existsSync, readFileSync, rmSync } from "node:fs";
import { EXIT, type ArgSpec, type OutLine } from "@pvx/sdk";
import { stripAnsi } from "../ansi.ts";
import { parseArgs } from "../engine/args.ts";
import { execute } from "../engine/execute.ts";
import { killExecGroups } from "../engine/exec.ts";
import { appendJobLog, createJobs, listAllJobs, readJobState, secretsFile, writeJobState } from "../engine/jobs.ts";
import { tokenize } from "../engine/tokenize.ts";
import type { CoreCommand, Ctx } from "./core.ts";

const usage = (o: Ctx["o"], text: string) => (o.line({ kind: "error", text }), EXIT.USAGE);
const GLYPH: Record<OutLine["kind"], string> = { success: "✓ ", warning: "! ", error: "✗ ", info: "i ", plain: "" };
const jobArgs: ArgSpec[] = [
  { name: "module", help: "Módulo dono do job", kind: "positional", required: true },
  { name: "name", help: "Nome do job", kind: "positional", required: true },
];
const hhmm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");

/** The detached process: runs the job's line through `execute`, streams its lines to the log, records the outcome. */
async function runJob({ io, o, rest }: Ctx): Promise<number> {
  const [id, name] = rest;
  const s = id && name ? readJobState(id, name) : undefined;
  if (!id || !name || !s) return usage(o, "job inexistente: `pvx jobs run <módulo> <nome>` é interno");
  let secrets: Record<string, string> = {};
  try {
    if (existsSync(secretsFile(id, name))) secrets = JSON.parse(readFileSync(secretsFile(id, name), "utf8"));
  } catch {}
  rmSync(secretsFile(id, name), { force: true }); // read once, gone before the command starts
  const env = { ...io.env, ...Object.fromEntries(Object.entries(secrets).map(([k, v]) => [`PVX_SECRET_${k.toUpperCase().replace(/-/g, "_")}`, v])) };
  const hide = Object.values(secrets).filter((v) => v.length > 3);
  const mlog = io.makeLogger(id);
  let prev = "";
  /** Raw tail to the job file (everything); module log gets it unless only its digits changed since the last mirrored line (progress bars). */
  const write = (t: string, level: "info" | "warn" | "error" = "info") => {
    const text = hide.reduce((x, v) => x.replaceAll(v, "***"), stripAnsi(t));
    appendJobLog(id, name, text);
    const shape = text.replace(/\d+/g, "#");
    if (level === "info" && shape === prev) return;
    prev = shape;
    try {
      mlog[level](`[job ${name}] ${text}`);
    } catch {}
  };
  mlog.info(`[job ${name}] rodando: ${id} ${s.line}`);
  writeJobState(id, name, { ...s, pid: process.pid });
  let stopping = false;
  const stopSignal = new AbortController();
  const onTerm = () => ((stopping = true), stopSignal.abort(), killExecGroups("SIGTERM"));
  process.on("SIGTERM", onTerm);
  let exit: number = EXIT.ERROR;
  try {
    const res = await execute(io.registry, [id, ...tokenize(s.line)], {
      makeLogger: io.makeLogger, confirmed: true, isRoot: io.isRoot, signal: stopSignal.signal, env, jobLog: write, onLine: (l) => write(`${GLYPH[l.kind]}${l.text}`, l.kind === "error" ? "error" : l.kind === "warning" ? "warn" : "info"),
    });
    exit = res.exit;
  } catch (e) {
    write(`✗ erro interno: ${(e as Error).message}`);
  } finally {
    process.off("SIGTERM", onTerm);
    const state = stopping ? "stopped" : exit === EXIT.OK ? "done" : "failed";
    mlog[state === "done" ? "info" : state === "stopped" ? "warn" : "error"](`[job ${name}] ${state === "done" ? "terminou" : state === "stopped" ? "parado" : "falhou"} (exit ${exit})`);
    const cur = readJobState(id, name) ?? s;
    writeJobState(id, name, { ...cur, state, endedAt: Date.now(), exit });
  }
  return exit;
}

const logArgs: ArgSpec[] = [
  ...jobArgs,
  { name: "tail", help: "Últimas N linhas (padrão: todas)", kind: "option" },
  { name: "follow", help: "Segue até o job acabar ou Ctrl+C (-f)", kind: "flag" },
];

const list: CoreCommand["run"] = async ({ o }) => {
  const jobs = await listAllJobs();
  if (!jobs.length) o.line({ kind: "info", text: "nenhum job" });
  for (const j of jobs) o.line({ kind: "plain", text: `${j.module}/${j.name}  ${j.state}  ${hhmm(j.startedAt)}${j.exit !== undefined ? `  exit ${j.exit}` : ""}` });
  return EXIT.OK;
};

export const JOBS_COMMANDS: CoreCommand[] = [
  { key: "jobs", help: "Lista os jobs em segundo plano (subcomandos: list, log, stop)", run: list },
  { key: "jobs list", help: "Lista os jobs em segundo plano de todos os módulos", run: list },
  {
    key: "jobs log",
    help: "Mostra o log de um job",
    args: logArgs,
    async run({ io, o, rest }) {
      const p = await parseArgs(logArgs, rest.map((a) => (a === "-f" ? "--follow" : a)), { env: io.env });
      if (!p.ok) return usage(o, p.message);
      const tail = p.args.tail === undefined ? undefined : Number(p.args.tail);
      if (tail !== undefined && (!Number.isInteger(tail) || tail < 0)) return usage(o, "`--tail` pede um número inteiro");
      const jobs = createJobs(String(p.args.module));
      const name = String(p.args.name);
      if ((await jobs.status(name)).state === "none") return o.line({ kind: "error", text: `job inexistente: ${p.args.module}/${name}` }), EXIT.NOT_FOUND;
      const first = await jobs.log(name, { tail });
      first.forEach((l) => o.line({ kind: "plain", text: l }));
      let seen = tail === undefined ? first.length : (await jobs.log(name)).length;
      const stop = io.signal ?? new AbortController().signal;
      while (p.args.follow && !stop.aborted) {
        const more = await jobs.log(name, { since: seen });
        more.forEach((l) => o.line({ kind: "plain", text: l }));
        seen += more.length;
        if (!more.length && (await jobs.status(name)).state !== "running") break;
        await Bun.sleep(500);
      }
      return EXIT.OK;
    },
  },
  {
    key: "jobs stop",
    help: "Para um job em segundo plano",
    args: jobArgs,
    root: true,
    noAudit: true, // `Jobs.stop` writes its own audit line
    async run({ io, o, rest }) {
      const p = await parseArgs(jobArgs, rest, { env: io.env });
      if (!p.ok) return usage(o, p.message);
      try {
        await createJobs(String(p.args.module)).stop(String(p.args.name));
      } catch (e) {
        return o.line({ kind: "error", text: (e as Error).message }), EXIT.ERROR;
      }
      o.line({ kind: "success", text: `job ${p.args.module}/${p.args.name} parado` });
      return EXIT.OK;
    },
  },
  { key: "jobs run", help: "Interno: executa um job; o pvx o inicia por conta própria", root: true, noAudit: true, run: runJob },
];
