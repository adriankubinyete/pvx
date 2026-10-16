import type { ArgSpec, CommandCtx, CommandDef } from "@pvx/sdk";
import { openNotes, parseNumber } from "../notes.ts";
import { EVENT_VERSION } from "../state.ts";
import { appendEvent, currentUser, readEvents } from "../storage.ts";
import { REMOVE_CONFIRM, TEXT } from "../texts.ts";

const ARGS: ArgSpec[] = [{ name: "n", label: "Número da nota", help: "O número que `nota list` mostra", kind: "positional", required: true }];

async function run(ctx: CommandCtx): Promise<void> {
  const raw = ctx.arg("n") ?? "";
  const n = parseNumber(raw);
  if (n === undefined) {
    ctx.out.error(TEXT.invalidNumber(raw));
    return;
  }
  const note = openNotes(await readEvents(ctx.fs)).find((open) => open.n === n);
  if (!note) {
    ctx.out.error(TEXT.missing(n));
    return;
  }
  await appendEvent(ctx.fs, { v: EVENT_VERSION, id: note.id, at: new Date().toISOString(), ev: "remove", author: currentUser() });
  ctx.out.success(TEXT.removed(n));
}

export const remove: CommandDef = { help: "Remove uma nota", args: ARGS, destructive: true, confirm: REMOVE_CONFIRM, run };
