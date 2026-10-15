import type { CommandCtx, Proof, ProofKit, ValidateKit } from "@pvx/sdk";

type Args = CommandCtx["args"];

const LIST_SEPARATOR = ",";

/** Typed readers over the parsed args (`ctx.arg`, `ctx.flag`, `ctx.option`, `ctx.list`). */
export function argGetters(args: Args): Pick<CommandCtx, "arg" | "flag" | "option" | "list"> {
  const text = (name: string) => (typeof args[name] === "string" ? (args[name] as string) : undefined);
  const splitList = (name: string) =>
    (text(name) ?? "")
      .split(LIST_SEPARATOR)
      .map((item) => item.trim())
      .filter(Boolean);
  return { arg: text, option: text, flag: (name) => args[name] === true, list: splitList };
}

/** `sdk.proof`: builders for `Proof` and the first-problem runner. */
export const proofKit: ProofKit = {
  ok: (text, extra) => ({ level: "ok", text, ...extra }),
  warn: (text, extra) => ({ level: "warn", text, ...extra }),
  error: (text, extra) => ({ level: "error", text, ...extra }),
  async firstProblem(...steps) {
    for (const step of steps) {
      const proof: Proof | undefined = await step();
      if (proof && proof.level !== "ok") return proof;
    }
    return undefined;
  },
};

/** `sdk.validate`. */
export const validateKit: ValidateKit = {
  firstProblem: (...problems) => problems.find((problem) => problem !== undefined),
};
