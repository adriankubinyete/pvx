// The commands about greeting. Each `run` reads as named steps; the detail lives in state.ts and texts.ts.
import type { CommandCtx, CommandDef } from "@pvx/sdk";
import { DEFAULT_NAME, recordGreeting } from "../state.ts";
import { TEXT } from "../texts.ts";

function reportGreeted(ctx: CommandCtx, name: string): void {
  ctx.out.success(TEXT.greeted(name));
}

export const greetCommands: Record<string, CommandDef> = {
  saudar: {
    help: "Saúda alguém e guarda o nome",
    args: [{ name: "nome", help: "Quem saudar", kind: "positional" }],
    run(ctx) {
      const name = ctx.arg("nome") ?? DEFAULT_NAME;
      recordGreeting(ctx.store, name);
      reportGreeted(ctx, name);
    },
  },
};
