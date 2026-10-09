import type { ModuleFactory } from "@pvx/sdk";

/** Parity fixture: one command with a flag and a secret. */
const factory: ModuleFactory = () => ({
  commands: {
    probe: {
      help: "Echoes its flag and the size of its secret",
      args: [
        { name: "loud", help: "Shout", kind: "flag" },
        { name: "key", help: "Key", kind: "option", secret: true, required: true },
      ],
      run(ctx) {
        ctx.out.success(`${ctx.args.loud ? "LOUD" : "quiet"}: chave com ${String(ctx.args.key).length} chars`);
        ctx.out.info("pronto");
      },
    },
  },
});
export default factory;
