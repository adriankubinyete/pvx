import type { CommandCtx, ExecResult, Shell, ShellOpts, ShellResult } from "@pvx/sdk";
import { messageOf, PermissionDenied, StepError } from "./errors.ts";

/** The exit code of a program that cannot start (the shell convention for "command not found"). */
export const NOT_FOUND_CODE = 127;
const COMMAND_WIDTH = 110;
const TAIL_LINES = 40;
const FAILURE_LINES = 6;
/** A package manager's progress redraw (`45% [====   ]`) says nothing worth keeping for a failure. */
const PROGRESS_REDRAW = /\d+%\s*\[|\[=*\s*\]|ETA\s*$/;
const ERROR_LINE = /error|fail|denied|cannot|unable|no match|no space/i;

/** `dnf install -y a b c…` cut to a width a screen can show. */
export function describeCommand(command: string, args: string[]): string {
  const text = [command, ...args].join(" ");
  return text.length > COMMAND_WIDTH ? `${text.slice(0, COMMAND_WIDTH - 1)}…` : text;
}

/** The lines of a failure worth showing: the ones that name an error, else the last ones. */
export function relevantOutput(tail: string[]): string[] {
  const errors = tail.filter((line) => ERROR_LINE.test(line));
  return (errors.length ? errors : tail).slice(-FAILURE_LINES);
}

function keepInTail(tail: string[], line: string): void {
  const text = line.trim();
  if (!text || PROGRESS_REDRAW.test(text)) return;
  tail.push(text);
  if (tail.length > TAIL_LINES) tail.shift();
}

/** A program that cannot start is exit 127; a permission violation of the host still throws. */
async function execOrNotFound(exec: CommandCtx["exec"], command: string, args: string[], opts: ShellOpts): Promise<ExecResult> {
  try {
    return await exec(command, args, opts);
  } catch (error) {
    if (error instanceof PermissionDenied) throw error;
    return { code: NOT_FOUND_CODE, stdout: "", stderr: messageOf(error) };
  }
}

/** `ctx.shell`, built over the granted `ctx.exec` (so the allowlist, the timeout and the process rules are the same). */
export function createShell(exec: CommandCtx["exec"]): Shell {
  const run: Shell["run"] = async (command, args = [], opts = {}) => {
    const tail: string[] = [];
    const onLine: NonNullable<ShellOpts["onLine"]> = (line, stream) => {
      keepInTail(tail, line);
      opts.onLine?.(line, stream);
    };
    const result = await execOrNotFound(exec, command, args, { ...opts, onLine });
    if (result.code === NOT_FOUND_CODE && result.stderr) keepInTail(tail, result.stderr);
    const shellResult: ShellResult = { ...result, tail };
    return shellResult;
  };
  const must: Shell["must"] = async (command, args = [], opts) => {
    const result = await run(command, args, opts);
    if (result.code === 0) return result;
    const shown = opts?.display ?? describeCommand(command, args);
    throw new StepError(`${shown} saiu com código ${result.code}`, shown, result.code, relevantOutput(result.tail));
  };
  const ok: Shell["ok"] = async (command, args = [], opts) => (await run(command, args, opts)).code === 0;
  return { run, must, ok };
}
