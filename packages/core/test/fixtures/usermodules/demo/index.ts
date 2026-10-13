import type { ModuleFactory } from "@pvx/sdk";

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
    echo: {
      help: "Declares a flag named like a global one",
      args: [{ name: "json", help: "Own flag", kind: "flag" }],
      run: (ctx) => ctx.out.success(`json=${ctx.args.json === true}`),
    },
    wipe: { help: "Destructive", destructive: true, run: (ctx) => ctx.out.success("apagado") },
    remember: { help: "Writes state", run: (ctx) => ctx.store.set("k", 1) },
  },
  queries: { "demo.status": () => "ready" },
});
export default factory;
