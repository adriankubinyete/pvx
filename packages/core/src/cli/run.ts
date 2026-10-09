import { EXIT, type Logger, type OutLine } from "@pvx/sdk";
import { fg, setColorEnabled } from "../ansi.ts";
import { execute } from "../engine/execute.ts";
import { pvxHome } from "../engine/paths.ts";
import { resolveCommand, type Registry } from "../engine/registry.ts";
import { CORE } from "./core.ts";
import { pathHelp, rootHelp } from "./help.ts";

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
  /** Aborts `logs -f`. */
  signal?: AbortSignal;
}

export interface Output {
  line(l: OutLine): void;
  finish(exit: number): number;
}

const GLYPH = { success: ["✓", "accent"], warning: ["!", "warn"], error: ["✗", "error"], info: ["i", "info"] } as const;

/** `[✓] text`: brackets and symbol in the level color, text in the main color; plain lines are bare. */
export function formatLine(l: OutLine, theme: Palette): string {
  if (l.kind === "plain") return l.text;
  const [glyph, color] = GLYPH[l.kind];
  return `${fg(theme[color], `[${glyph}]`)} ${fg(theme.text, l.text)}`;
}

/** Text mode streams lines as they come; --json prints one object at the end and nothing else. */
function createOutput(io: CliIO, json: boolean): Output {
  const lines: OutLine[] = [];
  return {
    line: (l) => (json ? void lines.push({ kind: l.kind, text: l.text }) : io.out(formatLine(l, io.theme))),
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
  const argv = io.argv.filter((a) => {
    if (a === "--json") json = true;
    else if (a === "--yes") yes = true;
    else if (a === "--help" || a === "-h") help = true;
    else return true;
    return false;
  });
  const o = createOutput(io, json);
  const catalog = [
    ...CORE,
    ...[...io.registry.commands].map(([key, c]) => ({ key, help: c.help, args: c.args, destructive: c.destructive })),
  ];
  const fail = (exit: number, text: string) => (o.line({ kind: "error", text }), o.finish(exit));
  const needRoot = () => fail(EXIT.ERROR, `grava em ${pvxHome()}: rode com sudo`);
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
    const core = [...CORE].reverse().find((c) => c.key.split(" ").every((w, i) => argv[i] === w));
    if (core) {
      if (core.root && !io.isRoot) return needRoot();
      return o.finish(await core.run({ io, o, rest: argv.slice(core.key.split(" ").length), json, yes }));
    }

    const found = resolveCommand(io.registry, argv);
    if (found && !io.isRoot) return needRoot();
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
      readStdin: io.readStdin,
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
