import type { CommandCtx, Sdk } from "@pvx/sdk";

export default (_sdk: Sdk) => ({
  commands: {
    // Prints what `ctx.slots.read` returns for a slot: `widget-demo read home.chips`.
    read: {
      help: "Mostra o último dado de um slot",
      args: [{ name: "slot", help: "Slot da home", kind: "positional" as const }],
      run: (ctx: CommandCtx) => ctx.out.plain(JSON.stringify(ctx.slots.read(ctx.args.slot as never) ?? null)),
    },
  },
  widgets: {
    chip: { slot: "home.chips" as const, priority: 20, data: () => [{ label: "demo", level: "ok" as const, detail: "tudo certo" }] },
    attention: { slot: "home.attention" as const, priority: 10, data: () => [{ level: "warn" as const, title: "demo: revisar o painel", fix: "widget-demo read home.chips" }] },
    boom: { slot: "home.chips" as const, priority: 1, data: (): never => { throw new Error("widget explodiu"); } },
    hang: { slot: "home.attention" as const, priority: 5, data: () => new Promise<never>(() => {}) },
  },
});
