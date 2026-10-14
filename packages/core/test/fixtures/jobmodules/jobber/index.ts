import type { ModuleFactory } from "@pvx/sdk";

/** Job fixture: `quick` writes lines and exits, `long` blocks, both read a secret. */
const factory: ModuleFactory = () => ({
  commands: {
    quick: {
      help: "Writes lines",
      args: [{ name: "token", help: "Token", kind: "option", secret: true }],
      run(ctx) {
        ctx.out.info("starting");
        ctx.jobLog(`raw=${ctx.args.token}`);
        ctx.out.success(`len=${String(ctx.args.token ?? "").length}`);
        ctx.out.plain(`argv=${process.argv.join(" ")}`);
      },
    },
    long: {
      help: "Blocks",
      args: [{ name: "token", help: "Token", kind: "option", secret: true }],
      async run(ctx) {
        ctx.out.info("blocking");
        await ctx.exec("sleep", ["60"], { timeoutMs: 120_000, signal: new AbortController().signal });
      },
    },
    progress: { help: "Progress", run: (ctx) => void ["a 10%", "a 55%", "a 100%", "fim"].forEach((l) => ctx.jobLog(l)) },
    bad: { help: "Fails", run: (ctx) => void ctx.out.error("boom") },
  },
});
export default factory;
