import type { StepError as StepErrorShape } from "@pvx/sdk";

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
