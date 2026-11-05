import { hostname } from "node:os";
import { EXIT } from "@pvx/sdk";
import { fg } from "../ansi.ts";
import { auditLogin, currentUser } from "../journal/index.ts";
import type { CoreCommand } from "./core.ts";
import type { CliIO } from "./run.ts";

const MAX_NOTES = 3;
const DEFAULT_COLS = 80;

/** The note the notes role returns (shape fixed by the `notesState` role in the SDK). */
interface NoteState {
  at: string;
  text: string;
  signature?: string;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** "há 5 min", "há 2 h", "há 3 d". */
function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return m < 1 ? "agora" : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)} h` : `há ${Math.floor(m / 1440)} d`;
}

/** The newest open notes, at most `MAX_NOTES`. */
async function readNotes(io: CliIO): Promise<NoteState[] | undefined> {
  const q = io.registry.roles.get("notesState")?.name;
  if (!q) return undefined;
  try {
    const open = (await io.registry.query(q)) as NoteState[];
    return [...open].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTES);
  } catch {
    return undefined; // a source that fails is skipped, never the login
  }
}

/** `texto — assinatura`, or just the text when nobody signed. */
const noteText = (note: NoteState): string => (note.signature ? `${one(note.text)} — ${one(note.signature)}` : one(note.text));

/**
 * The login banner: plain text from one registry query for the notes. It evaluates nothing and fetches nothing, so it stays far below the 1 s the hook allows.
 */
export async function bannerLines(io: CliIO, now = Date.now()): Promise<string[]> {
  const cols = Math.max(20, Number(io.env.COLUMNS) || DEFAULT_COLS);
  const accent = (s: string) => fg(io.theme.accent, s);
  const dim = (s: string) => fg(io.theme.info, s);
  const rule = accent("═".repeat(Math.min(cols, 78)));
  const body: string[] = [];

  const notes = await readNotes(io);
  if (notes?.length) {
    body.push("notas");
    for (const n of notes) body.push(`  ${accent("▸")} ${cut(noteText(n), cols - 4)}`);
  }

  const head = hostname();
  const version = `pvx ${io.version}`;
  const title = head.length + version.length + 3 <= cols ? `${head}${" ".repeat(cols - head.length - version.length - 1)}${version}` : cut(head, cols);
  return [rule, title, rule, ...body, ...(body.length ? [rule] : []), dim(cut("digite pvx para abrir · PVX_QUIET=1 silencia", cols))];
}

export const BANNER_COMMAND: CoreCommand = {
  key: "banner",
  help: "Banner de login: texto puro, das notas (nunca avalia)",
  async run({ io, o }) {
    for (const text of await bannerLines(io)) o.line({ kind: "plain", text });
    auditLogin(currentUser(io.env), io.env.SSH_CLIENT?.split(" ")[0]); // best effort: a non-root login just records nothing
    return EXIT.OK;
  },
};
