import type { ErrorsKit, StepError as StepErrorShape } from "@pvx/sdk";

/** Thrown when a module asks for something its manifest did not list. It is a module bug: `shell` never turns it into an exit code. */
export class PermissionDenied extends Error {
  override name = "PermissionDenied";
}

/** What a failed step throws: what was run, its exit code and the useful lines of its output. */
export class StepError extends Error implements StepErrorShape {
  override name = "StepError" as const;
  constructor(
    message: string,
    readonly command: string,
    readonly code: number | undefined,
    readonly output: string[],
  ) {
    super(message);
  }
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Duck-typed on purpose: a module can build its own error with the same shape. */
export const isStepError = (error: unknown): error is StepErrorShape => error instanceof Error && error.name === "StepError";

const OUTPUT_INDENT = "  ";

/** The message of any error; a `StepError` adds the useful lines of its output, one per line, indented. */
export function describeFailure(error: unknown): string {
  const message = messageOf(error);
  if (!isStepError(error)) return message;
  const output = error.output.map((line) => `${OUTPUT_INDENT}${line}`);
  return [message, ...output].join("\n");
}

/** `sdk.errors`. */
export const errorsKit: ErrorsKit = { isStepError, describeFailure };
