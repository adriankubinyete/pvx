import { hostname } from "node:os";
import { EXIT } from "@pvx/sdk";
import { fg } from "../ansi.ts";
import { activeIgnores, auditLogin, currentUser, lastSeen, readSnapshot } from "../diary/index.ts";
import type { CoreCommand } from "./core.ts";
import type { CliIO } from "./run.ts";

const MAX_PENDING = 5;
const MAX_NOTES = 3;
const DEFAULT_COLS = 80;

/** The folded note the notes role returns (shape fixed by the `notesState` role in the SDK). */
interface NoteState {
  author: string;
  at: string;
  text: string;
  pinned: boolean;
  login?: boolean;
  resolved: boolean;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** "há 5 min", "há 2 h", "há 3 d". */
function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return m < 1 ? "agora" : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)} h` : `há ${Math.floor(m / 1440)} d`;
}

/** Pinned (or login-flagged) open notes, newest first, and how many open notes by others are newer than the user's marker. */
async function readNotes(io: CliIO, me: string): Promise<{ shown: NoteState[]; fresh: number } | undefined> {
  const q = io.registry.roles.get("notesState")?.name;
  if (!q) return undefined;
  try {
    const open = ((await io.registry.query(q)) as NoteState[]).filter((n) => !n.resolved);
    const seen = lastSeen(me) ?? 0;
    const shown = open.filter((n) => n.pinned || n.login).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at.localeCompare(a.at));
    return { shown: shown.slice(0, MAX_NOTES), fresh: open.filter((n) => n.author !== me && Date.parse(n.at) > seen).length };
  } catch {
    return undefined; // a source that fails is skipped, never the login
  }
}

/**
 * The login banner: plain text from what is already on disk (the last conformity snapshot) and one registry query for
 * the notes. It evaluates nothing and fetches nothing, so it stays far below the 1 s the hook allows.
 */
export async function bannerLines(io: CliIO, now = Date.now()): Promise<string[]> {
  const cols = Math.max(20, Number(io.env.COLUMNS) || DEFAULT_COLS);
  const accent = (s: string) => fg(io.theme.accent, s);
  const dim = (s: string) => fg(io.theme.info, s);
  const level = { ok: ["✓", io.theme.accent], warn: ["!", io.theme.warn], error: ["✗", io.theme.error] } as const;
  const me = currentUser(io.env);
  const rule = accent("═".repeat(Math.min(cols, 78)));
  const body: string[] = [];

  const snap = readSnapshot();
  if (snap) {
    const skip = new Set(activeIgnores(now).map((i) => i.id));
    const live = snap.results.filter((r) => !skip.has(r.id) || r.level === "ok");
    const pending = live.filter((r) => r.level !== "ok");
    body.push(cut(`checklist ${live.length - pending.length}/${live.length} · verificado ${ago(now - snap.at)}`, cols));
    for (const r of pending.slice(0, MAX_PENDING)) {
      const [glyph, color] = level[r.level];
      body.push(`${fg(color, `[${glyph}]`)} ${cut(one(r.text), cols - 5)}`);
      if (r.fix) body.push(`    ${dim("→")} ${cut(one(r.fix), cols - 7)}`);
    }
    if (pending.length > MAX_PENDING) body.push(dim(cut(`+${pending.length - MAX_PENDING} pendência(s): pvx conformidade`, cols)));
  }

  const notes = await readNotes(io, me);
  if (notes && (notes.shown.length || notes.fresh)) {
    body.push(cut(`notas${notes.fresh ? ` · ${notes.fresh} ${notes.fresh === 1 ? "nova" : "novas"} para você` : ""}`, cols));
    for (const n of notes.shown) body.push(`  ${accent("▸")} ${cut(`${one(n.author)}: ${one(n.text)}`, cols - 4)}`);
  }

  const profile = snap ? ` · perfil ${snap.profile}` : "";
  const head = `${hostname()}${profile}`;
  const version = `pvx ${io.version}`;
  const title = head.length + version.length + 3 <= cols ? `${head}${" ".repeat(cols - head.length - version.length - 1)}${version}` : cut(head, cols);
  return [rule, title, rule, ...body, ...(body.length ? [rule] : []), dim(cut("digite pvx para abrir · PVX_QUIET=1 silencia", cols))];
}

export const BANNER_COMMAND: CoreCommand = {
  key: "banner",
  help: "Banner de login: texto puro, do último resultado de conformidade e das notas (nunca avalia)",
  async run({ io, o }) {
    for (const text of await bannerLines(io)) o.line({ kind: "plain", text });
    auditLogin(currentUser(io.env), io.env.SSH_CLIENT?.split(" ")[0]); // best effort: a non-root login just records nothing
    return EXIT.OK;
  },
};
