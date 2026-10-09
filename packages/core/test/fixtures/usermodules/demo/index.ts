import type { ModuleFactory } from "../../../../../sdk/src/index.ts";

const factory: ModuleFactory = (sdk) => ({
  commands: {
    greet: {
      help: "Greets",
      args: [
        { name: "who", help: "Name", kind: "positional", required: true },
        { name: "shout", help: "Uppercase", kind: "flag" },
      ],
      run(ctx) {
        const t = `oi ${ctx.args.who}`;
        ctx.out.success(ctx.args.shout ? t.toUpperCase() : t);
        if (ctx.args.who === "warn") ctx.out.warning("cuidado");
        if (ctx.args.who === "bad") ctx.out.error("falhou");
      },
    },
    login: {
      help: "Uses a secret",
      args: [{ name: "token", help: "Token", kind: "option", secret: true, required: true }],
      run(ctx) {
        ctx.out.success(`token com ${String(ctx.args.token).length} chars`);
      },
    },
    wipe: { help: "Destructive", destructive: true, run: (ctx) => ctx.out.success("apagado") },
    remember: { help: "Writes state", run: (ctx) => ctx.store.set("k", 1) },
  },
  queries: { "demo.status": () => "ready" },
});
export default factory;
