import type { CommandCtx, CommandDef } from "@pvx/sdk";
import { bodyText, dateText, newestFirst, openNotes } from "../notes.ts";
import { readEvents } from "../storage.ts";
import { TEXT } from "../texts.ts";

async function run(ctx: CommandCtx): Promise<void> {
  const notes = newestFirst(openNotes(await readEvents(ctx.fs)));
  if (!notes.length) {
    ctx.out.info(TEXT.none);
    return;
  }
  const width = String(Math.max(...notes.map((note) => note.n))).length;
  for (const note of notes) ctx.out.plain(`${String(note.n).padStart(width)}  ${dateText(note.at)}  ${bodyText(note)}`);
}

export const list: CommandDef = { help: "Lista as notas, as mais novas primeiro", readonly: true, run };
