// `sdk.crontab`: ONE marked block of a user's crontab, edited safely. A read that fails for any reason but "this user has no crontab yet"
// aborts, so a hiccup can never turn into a write of an empty crontab over the real one. Every line outside the block is kept as it was.
import type { CrontabBlock, CrontabError, CrontabKit, Shell } from "@pvx/sdk";

class CrontabFailure extends Error implements CrontabError {
  override name = "CrontabError" as const;
}

const isCrontabError = (error: unknown): error is CrontabError => error instanceof CrontabFailure;

const PROGRAM = "crontab";
const PROBE_TIMEOUT_MS = 2 * 60_000;

/** `crontab -l` says this on stderr (exit 1) for a user that has never had a crontab: the only failure that means "empty". */
const NO_CRONTAB = /no crontab for/i;

/** The message above is English: ask for the C locale so a translated system cannot turn "empty" into a failure. */
const C_LOCALE = { LC_ALL: "C" };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The lines of a crontab, without the empty element a trailing newline leaves. */
function parseCrontab(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const crontabText = (lines: string[]): string => (lines.length ? `${lines.join("\n")}\n` : "");

interface BlockSpan {
  begin: number;
  end: number;
}
type BlockSearch = { span: BlockSpan | undefined } | { error: string };

const DAMAGED_BLOCK = (begin: string): string => `o bloco "${begin}" no crontab está incompleto ou duplicado: corrija à mão (\`crontab -e\`) e rode de novo`;

const indexesOf = (lines: string[], marker: string): number[] => lines.flatMap((line, index) => (line.trim() === marker ? [index] : []));

/** Where the block is. A half block, a block inside another or two blocks mean someone edited it by hand: stop instead of guessing. */
function findBlock(lines: string[], begin: string, end: string): BlockSearch {
  const begins = indexesOf(lines, begin);
  const ends = indexesOf(lines, end);
  if (begins.length === 0 && ends.length === 0) return { span: undefined };
  const [first] = begins;
  const [last] = ends;
  if (begins.length !== 1 || ends.length !== 1 || first === undefined || last === undefined || last < first) return { error: DAMAGED_BLOCK(begin) };
  return { span: { begin: first, end: last } };
}

function blockLines(begin: string, end: string, entries: string[]): string[] {
  return entries.length ? [begin, ...entries, end] : [];
}

async function readLines(shell: Pick<Shell, "run">): Promise<string[]> {
  const result = await shell.run(PROGRAM, ["-l"], { timeoutMs: PROBE_TIMEOUT_MS, env: C_LOCALE });
  if (result.code === 0) return parseCrontab(result.stdout);
  if (NO_CRONTAB.test(result.stderr)) return [];
  const detail = result.stderr.trim() || `saída ${result.code}`;
  throw new CrontabFailure(`não consegui ler o crontab (${detail}): nada foi alterado`);
}

async function writeLines(shell: Pick<Shell, "must">, lines: string[]): Promise<void> {
  try {
    await shell.must(PROGRAM, ["-"], { stdin: crontabText(lines), timeoutMs: PROBE_TIMEOUT_MS });
  } catch (error) {
    throw new CrontabFailure(`não consegui gravar o crontab: ${messageOf(error)}`);
  }
}

/** Puts the crontab back after a failed commit; says so when even that fails. */
async function rollBack(shell: Pick<Shell, "must">, before: string[], cause: unknown): Promise<never> {
  try {
    await writeLines(shell, before);
  } catch (restoreError) {
    throw new CrontabFailure(`${messageOf(cause)}; e o crontab pode ainda ter o bloco novo (${messageOf(restoreError)})`);
  }
  throw cause;
}

function blockOf(id: string): CrontabBlock {
  const begin = `# BEGIN pvx ${id} (gerenciado pelo pvx: não edite à mão)`;
  const end = `# END pvx ${id}`;
  const entries: CrontabBlock["entries"] = (lines) => {
    const found = findBlock(lines, begin, end);
    if ("error" in found) return found;
    if (!found.span) return [];
    return lines.slice(found.span.begin + 1, found.span.end);
  };
  const merge: CrontabBlock["merge"] = (lines, wanted) => {
    const found = findBlock(lines, begin, end);
    if ("error" in found) return found;
    const block = blockLines(begin, end, wanted);
    if (!found.span) return { lines: [...lines, ...block] };
    return { lines: [...lines.slice(0, found.span.begin), ...block, ...lines.slice(found.span.end + 1)] };
  };
  const sync: CrontabBlock["sync"] = async (shell, wanted) => {
    const before = await readLines(shell);
    const merged = merge(before, wanted);
    if ("error" in merged) throw new CrontabFailure(merged.error);
    await writeLines(shell, merged.lines);
    return before;
  };
  const update: CrontabBlock["update"] = async (shell, wanted, commit) => {
    const before = await sync(shell, wanted);
    try {
      await commit();
    } catch (error) {
      await rollBack(shell, before, error);
    }
  };
  return { begin, end, read: readLines, entries, merge, sync, restore: writeLines, update };
}

/** `sdk.crontab`. */
export const crontabKit: CrontabKit = { block: blockOf, isError: isCrontabError };
