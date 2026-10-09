import { EXIT } from "@pvx/sdk";
import type { Logger, OutLine } from "@pvx/sdk";
import { parseArgs, type ArgValues, type ParseOpts } from "./args.ts";
import { createGranted } from "./permissions.ts";
import { resolveCommand, type Registry } from "./registry.ts";
import { createStore } from "./store.ts";
import { tokenize } from "./tokenize.ts";

export interface ExecOpts extends ParseOpts {
  makeLogger: (name: string) => Logger;
  /** --yes or an interactive confirmation already given. */
  confirmed?: boolean;
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

  const log = opts.makeLogger(cmd.moduleId);
  log.info(`run ${key} ${JSON.stringify(masked)}`);
  const lines: OutLine[] = [];
  const add = (kind: OutLine["kind"]) => (text: string) => void lines.push({ kind, text });
  try {
    await cmd.run({
      args: parsed.args,
      out: { success: add("success"), warning: add("warning"), error: add("error"), info: add("info"), plain: add("plain") },
      log,
      store: createStore(cmd.moduleId),
      query: registry.query,
      slots: registry.slots,
      ...createGranted(cmd.moduleId, registry.modules.get(cmd.moduleId)?.permissions, log, opts.makeLogger("core")),
    });
  } catch (e) {
    log.error(`exceção em ${key}: ${(e as Error).stack ?? e}`);
    lines.push({ kind: "error", text: `erro interno no comando: ${(e as Error).message ?? e}` });
  }
  const failed = lines.some((l) => l.kind === "error");
  return { ok: !failed, exit: failed ? EXIT.ERROR : EXIT.OK, lines, masked };
}
