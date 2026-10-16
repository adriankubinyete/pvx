// Reading and appending the events; the rest of the module never touches the file.
import type { CommandCtx, ReadCtx } from "@pvx/sdk";
import { oneLine, parseEvents } from "./notes.ts";
import { NOTES_FILE, type NoteEvent } from "./state.ts";

/** The user who runs the command: `SUDO_USER`, else `LOGNAME`. */
export const currentUser = (): string => oneLine(process.env.SUDO_USER || process.env.LOGNAME || "") || "desconhecido";

export async function readEvents(fs: Pick<ReadCtx["fs"], "read" | "exists">): Promise<NoteEvent[]> {
  if (!(await fs.exists(NOTES_FILE))) return [];
  return parseEvents(await fs.read(NOTES_FILE));
}

/** One line, one write call: two commands at once never interleave. */
export function appendEvent(fs: CommandCtx["fs"], event: NoteEvent): Promise<void> {
  return fs.append(NOTES_FILE, `${JSON.stringify(event)}\n`);
}
