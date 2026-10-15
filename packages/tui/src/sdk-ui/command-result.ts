// What a page says of a command that ran. Pure: `CommandResult` only draws it.
import type { CommandRun, OutLine, StepError, Tone } from "@pvx/sdk";

export interface ResultLine {
  text: string;
  tone: Tone;
}

export interface ResultView {
  title: "Erro" | "Concluído";
  tone: Tone;
  lines: ResultLine[];
  /** Dim lines under the message: the failed command, its output tail, an unusual exit code. */
  details: string[];
}

const TONE_BY_KIND: Record<OutLine["kind"], Tone> = { success: "ok", warning: "warn", error: "error", info: "info", plain: "text" };
/** How many lines of a failed command's output show. */
const OUTPUT_TAIL = 4;
/** Exit codes that need no explanation: 0 is success and 1 is the common failure. The title already says it. */
const PLAIN_EXIT_CODES = [0, 1];

const exitCodeLine = (exit: number): string[] => (PLAIN_EXIT_CODES.includes(exit) ? [] : [`código de saída ${exit}`]);

function failureLines(failure: StepError | undefined): string[] {
  if (!failure) return [];
  return [`$ ${failure.command}`, ...failure.output.slice(-OUTPUT_TAIL)];
}

export function resultViewOf(run: CommandRun, failure?: StepError): ResultView {
  const failed = run.exit !== 0;
  return {
    title: failed ? "Erro" : "Concluído",
    tone: failed ? "error" : "ok",
    lines: run.lines.map((line) => ({ text: line.text, tone: TONE_BY_KIND[line.kind] })),
    details: [...failureLines(failure), ...exitCodeLine(run.exit)],
  };
}
