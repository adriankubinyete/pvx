// Single owner of PVX_HOME/notes.jsonl. Written like any usermodule: `fs` is bound to the manifest's permissions.
import type { HomeNote, ModuleDef, ReadCtx } from "@pvx/sdk";
import { add } from "./commands/add.ts";
import { list } from "./commands/list.ts";
import { remove } from "./commands/remove.ts";
import { newestFirst, openNotes } from "./notes.ts";
import { readEvents } from "./storage.ts";

/** The open notes, newest first: what the login banner and the Início section read. */
async function currentNotes(ctx: ReadCtx): Promise<HomeNote[]> {
  const notes = newestFirst(openNotes(await readEvents(ctx.fs)));
  return notes.map((note) => ({ n: note.n, at: note.at, text: note.text, signature: note.signature }));
}

export default (): ModuleDef => ({
  commands: { add, remove, list },
  queries: {
    async "notas.state"() {
      return currentNotes(this);
    },
  },
  widgets: {
    home: { slot: "home.notes", priority: 0, refreshMs: 10_000, data: (ctx) => currentNotes(ctx) },
  },
  roles: { notesState: "notas.state", addNote: "nota add", removeNote: "nota remove" },
});
