import type { ModuleFactory } from "@pvx/sdk";

/** The module as it ships: commands, a query and a proof that touch the machine through ctx only. */
const factory: ModuleFactory = (sdk) => ({
  commands: {
    run: {
      help: "Runs the tool and leaves a marker",
      async run(ctx) {
        if (!ctx.isRoot) {
          ctx.out.error("precisa de root");
          return;
        }
        await ctx.shell.echoing().must("tool", ["go"]);
        await ctx.fs.write("/etc/machine-demo/marker", "feito");
        ctx.out.success("rodou");
      },
    },
  },
  queries: {
    "machine-demo.version": async function () {
      return (await this.shell.run("tool", ["--version"])).tail.join("");
    },
  },
  capabilities: [
    {
      id: "machine-demo.root",
      title: "Root",
      goal: "Roda como root",
      prove: (ctx) => (ctx.isRoot ? sdk.proof.ok("root") : sdk.proof.warn("sem root")),
    },
  ],
});
export default factory;
