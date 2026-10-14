import { argGetters } from "./helpers.ts";
import { EXIT } from "@pvx/sdk";
import type { AbortSignalLike, Logger, OutLine, SessionInfo } from "@pvx/sdk";
import { hostIsRoot } from "../host/root.ts";
import { hostSession } from "../host/ssh.ts";
import { auditCommand, lineOf } from "../journal/audit.ts";
import { parseArgs, type ArgValues, type ParseOpts } from "./args.ts";
import { describeFailure } from "./errors.ts";
import { createJobs } from "./jobs.ts";
import { createGranted } from "./permissions.ts";
import { createPhases } from "./phases.ts";
import { createShell } from "./shell.ts";
import { resolveCommand, type Registry } from "./registry.ts";
import { createStore } from "./store.ts";
import { strategyKit } from "./strategy.ts";
import { tokenize } from "./tokenize.ts";

export interface ExecOpts extends ParseOpts {
  makeLogger: (name: string) => Logger;
  /** --yes or an interactive confirmation already given. */
  confirmed?: boolean;
  /** Every `ctx.out` line, as it is written (a job streams them to its log). */
  onLine?: (l: OutLine) => void;
  /** What `ctx.jobLog` writes to; without it `ctx.jobLog` does nothing. */
  jobLog?: (line: string) => void;
  /** `ctx.session` of the command. Default: the real host session (tests hand a fixed one). */
  session?: SessionInfo;
  /** `ctx.isRoot` of the command. Default: the real process (tests hand a fixed one). */
  isRoot?: boolean;
  /** `ctx.signal`: aborted when the job is stopped. Default: a signal that never aborts. */
  signal?: AbortSignalLike;
}
export interface ExecResult {
  ok: boolean;
  exit: number;
  lines: OutLine[];
  /** Parsed args with secrets as "***": safe for log, history and audit. */
  masked?: ArgValues;
}

const err = (exit: number, text: string): ExecResult => ({ ok: false, exit, lines: [{ kind: "error", text }] });

/** Never calls process.exit nor writes to stdout. */
export async function execute(registry: Registry, input: string | string[], opts: ExecOpts): Promise<ExecResult> {
  let argv: string[];
  try {
    argv = typeof input === "string" ? tokenize(input) : input;
  } catch (e) {
    return err(EXIT.USAGE, (e as Error).message);
  }
  const found = resolveCommand(registry, argv);
  if (!found) return err(EXIT.NOT_FOUND, `comando não encontrado: ${argv.join(" ") || "(vazio)"}`);
  const { key, cmd, n } = found;

  const parsed = await parseArgs(cmd.args, argv.slice(n), opts);
  if (!parsed.ok) return err(EXIT.USAGE, parsed.message);
  const { masked } = parsed;
  if (cmd.destructive && opts.confirmed !== true) {
    return { ...err(EXIT.USAGE, `comando destrutivo: passe --yes para confirmar`), masked };
  }

  const session = opts.session ?? hostSession;
  const signal = opts.signal ?? new AbortController().signal;
  const jobLog = opts.jobLog ?? (() => {});
  const log = opts.makeLogger(cmd.moduleId);
  log.info(`run ${key} ${JSON.stringify(masked)}`);
  const lines: OutLine[] = [];
  const t0 = Date.now();
  const add = (kind: OutLine["kind"]) => (text: string) => {
    const l = { kind, text };
    lines.push(l);
    opts.onLine?.(l);
  };
  const store = createStore(cmd.moduleId);
  const granted = createGranted(cmd.moduleId, registry.modules.get(cmd.moduleId)?.permissions, log, opts.makeLogger("core"));
  const out = { success: add("success"), warning: add("warning"), error: add("error"), info: add("info"), plain: add("plain") };
  try {
    await cmd.run({
      args: parsed.args,
      ...argGetters(parsed.args),
      out,
      log,
      store,
      query: registry.query,
      slots: registry.slots,
      session,
      jobs: createJobs(cmd.moduleId),
      jobLog,
      isRoot: opts.isRoot ?? hostIsRoot(),
      signal,
      ...granted,
      shell: createShell(granted.exec, { jobLog, signal }),
      strategy: strategyKit,
      phases: createPhases(store, out),
    });
  } catch (e) {
    log.error(`exceção em ${key}: ${(e as Error).stack ?? e}`);
    lines.push({ kind: "error", text: `erro interno no comando: ${describeFailure(e)}` });
  }
  const failed = lines.some((l) => l.kind === "error");
  // Masked by construction: `parseArgs` refuses a secret in argv (it comes from stdin, env or the prompt), so the line has none.
  auditCommand({ line: lineOf(argv), exit: failed ? EXIT.ERROR : EXIT.OK, ms: Date.now() - t0, destructive: Boolean(cmd.destructive), session: opts.session });
  return { ok: !failed, exit: failed ? EXIT.ERROR : EXIT.OK, lines, masked };
}
