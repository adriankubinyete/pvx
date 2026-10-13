import { EXIT, type Logger, type OutLine } from "@pvx/sdk";
import { fg, setColorEnabled } from "../ansi.ts";
import { auditCommand, lineOf } from "../journal/index.ts";
import { execute } from "../engine/execute.ts";
import { pvxHome } from "../engine/paths.ts";
import { resolveCommand, type Registry } from "../engine/registry.ts";
import type { ModuleRow } from "../modules/index.ts";
import type { PlanStep } from "../plan/index.ts";
import { CORE, RESERVED } from "./core.ts";
import { catalogOf, pathHelp, rootHelp } from "./help.ts";

export interface Palette {
  text: string;
  accent: string;
  warn: string;
  error: string;
  info: string;
}

/** Everything the runner touches from the outside. It never reads process.* nor calls process.exit. */
export interface CliIO {
  argv: string[];
  env: Record<string, string | undefined>;
  isTTY: boolean;
  /** Real uid 0. Injected so tests can run module commands; the entrypoint passes no bypass. */
  isRoot: boolean;
  registry: Registry;
  makeLogger: (name: string) => Logger;
  profilesDir: string;
  version: string;
  theme: Palette;
  /** One call per output line (no trailing newline). */
  out: (line: string) => void;
  readStdin?: () => Promise<string>;
  /** TTY only: reads one visible line. */
  ask?: (question: string) => Promise<string>;
  /** TTY only: reads a secret without echo. */
  askSecret?: (name: string) => Promise<string | undefined>;
  /** Tests only: lets `modules add` accept file:// URLs. The entrypoint never sets it. */
  allowFile?: boolean;
  /** First words of the core commands (a module id equal to one is refused). Default: derived from CORE. */
  reservedWords?: string[];
  /** Aborts `logs -f`. */
  signal?: AbortSignal;
}

/** An output line that may carry the command that fixes it (conformidade; JSON mode only shows it). */
export interface CoreLine extends OutLine {
  fix?: string;
  /** `plano` only: the step this line lists (JSON mode only shows it). */
  step?: PlanStep;
  /** `modules` listing only: the row, with its `state` (JSON mode only shows it). */
  module?: ModuleRow;
  /** `conformidade` only: ISO instant until which this pending item is ignored. */
  ignored?: string;
}

export interface Output {
  line(l: CoreLine): void;
  finish(exit: number): number;
}

const GLYPH = { success: ["✓", "accent"], warning: ["!", "warn"], error: ["✗", "error"], info: ["i", "info"] } as const;

/** `[✓] text`: brackets and symbol in the level color, text in the main color; plain lines are bare. */
export function formatLine(l: OutLine, theme: Palette): string {
  if (l.kind === "plain") return l.text;
  const [glyph, color] = GLYPH[l.kind];
  return `${fg(theme[color], `[${glyph}]`)} ${fg(theme.text, l.text)}`;
}

const findCore = (argv: string[]) => [...CORE].reverse().find((c) => c.key.split(" ").every((w, i) => argv[i] === w));

/** Strict root, one rule for the CLI and the TUI: every module command needs uid 0 unless it is `readonly`; core commands only if they write (`root`). */
export const requiresRoot = (registry: Registry, argv: string[]): boolean => {
  const core = findCore(argv);
  if (core) return Boolean(core.root);
  const found = resolveCommand(registry, argv);
  return Boolean(found) && !found!.cmd.readonly;
};
export const rootMessage = () => `grava em ${pvxHome()}: rode com sudo`;

/** Runs a line through `runCli` in `--json` mode and returns its lines: how the TUI reaches the core commands. */
export async function runCapture(io: Omit<CliIO, "argv" | "out" | "isTTY">, argv: string[]): Promise<{ exit: number; lines: CoreLine[] }> {
  let text = "";
  const exit = await runCli({ ...io, argv: [...argv, "--json"], isTTY: false, out: (l) => void (text += l) });
  return { exit: exit === "tui" ? EXIT.OK : exit, lines: (JSON.parse(text) as { lines: CoreLine[] }).lines };
}

/** Text mode streams lines as they come; --json prints one object at the end and nothing else. */
function createOutput(io: CliIO, json: boolean): Output {
  const lines: CoreLine[] = [];
  return {
    line: (l) => (json ? void lines.push({ kind: l.kind, text: l.text, ...(l.fix ? { fix: l.fix } : {}), ...(l.step ? { step: l.step } : {}), ...(l.module ? { module: l.module } : {}), ...(l.ignored ? { ignored: l.ignored } : {}) }) : io.out(formatLine(l, io.theme))),
    finish(exit) {
      if (json) io.out(JSON.stringify({ ok: exit === EXIT.OK, exit, lines }));
      return exit;
    },
  };
}

/** Returns the exit code, or "tui" when a TTY user ran `pvx` with no arguments. */
export async function runCli(io: CliIO): Promise<number | "tui"> {
  setColorEnabled(io.isTTY && !io.env.NO_COLOR);
  let json = false;
  let yes = false;
  let help = false;
  const argv = (io.argv.length === 1 && io.argv[0] === "--version" ? ["version"] : io.argv).filter((a) => {
    if (a === "--json") json = true;
    else if (a === "--yes") yes = true;
    else if (a === "--help" || a === "-h") help = true;
    else return true;
    return false;
  });
  if (argv[0] === "h") argv[0] = "help";
  io = { ...io, reservedWords: io.reservedWords ?? RESERVED };
  const o = createOutput(io, json);
  const catalog = catalogOf(CORE, io.registry);
  const fail = (exit: number, text: string) => (o.line({ kind: "error", text }), o.finish(exit));
  const showHelp = (lines: string[]) => lines.forEach((text) => o.line({ kind: "plain", text }));

  if (!argv.length) {
    if (io.isTTY && !json && !help) return "tui";
    showHelp(rootHelp(io.version, CORE, io.registry));
    return o.finish(help ? EXIT.OK : EXIT.USAGE);
  }
  if (help) {
    const lines = pathHelp(catalog, argv);
    if (!lines) return fail(EXIT.NOT_FOUND, `comando não encontrado: ${argv.join(" ")}`);
    showHelp(lines);
    return o.finish(EXIT.OK);
  }

  try {
    if (!io.isRoot && requiresRoot(io.registry, argv)) return fail(EXIT.ERROR, rootMessage());
    const core = findCore(argv);
    if (core) {
      const t0 = Date.now();
      const exit = await core.run({ io, o, rest: argv.slice(core.key.split(" ").length), json, yes });
      if (!core.noAudit) auditCommand({ line: lineOf(argv), exit, ms: Date.now() - t0, destructive: false }, { mutation: core.root }); // `root` = writes PVX_HOME
      return o.finish(exit);
    }

    const found = resolveCommand(io.registry, argv);
    let confirmed = yes;
    if (found?.cmd.destructive && !yes && io.isTTY && io.ask) {
      const a = (await io.ask(`\`${found.key}\` é destrutivo. Continuar? [s/N] `)).trim().toLowerCase();
      if (a !== "s" && a !== "sim") return fail(EXIT.ERROR, "cancelado");
      confirmed = true;
    }
    const res = await execute(io.registry, argv, {
      makeLogger: io.makeLogger,
      confirmed,
      env: io.env,
      readStdin: io.isTTY ? undefined : io.readStdin,
      promptSecret: io.isTTY ? io.askSecret : undefined,
    });
    res.lines.forEach((l) => o.line(l));
    return o.finish(res.exit);
  } catch (e) {
    // Last resort: a bug in the host must not crash the session.
    io.makeLogger("core").error(`exceção: ${(e as Error).stack ?? e}`);
    return fail(EXIT.ERROR, `erro interno: ${(e as Error).message ?? e}`);
  }
}
