/** Git for module repositories: Bun.spawn, no prompts, hard timeouts, readable errors (never a stack trace in user output). */

export class GitError extends Error {}

const LOCAL_MS = 15_000;
const NET_MS = 120_000;

/** Only https and ssh (scp-like included); `file` only with `allowFile` (tests and link). No credentials inside the URL. */
export function checkUrl(url: string, allowFile = false): void {
  if (!url || url.startsWith("-") || /\s/.test(url)) throw new GitError(`URL inválida: \`${url}\``);
  if (/^[\w.-]+@[\w.-]+:[^/\s]/.test(url)) return; // scp-like: git@host:org/repo
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new GitError(`URL inválida: \`${url}\``);
  }
  if (u.protocol === "https:") {
    if (u.username || u.password) throw new GitError("URL com credenciais não é aceita; use as chaves ou o helper do usuário");
    return;
  }
  if (u.protocol === "ssh:") return;
  if (u.protocol === "file:" && allowFile) return;
  throw new GitError(`esquema não permitido em \`${url}\` (só https e ssh)`);
}

interface Run {
  timeoutMs?: number;
  allowFile?: boolean;
}

/** Runs `git <args>` (cwd = `dir` when given). Hooks are off, nothing prompts, ext/file transports are closed unless allowed. */
export async function git(dir: string | undefined, args: string[], o: Run = {}): Promise<string> {
  const full = [
    "git",
    "-c", "core.hooksPath=/dev/null",
    "-c", "protocol.ext.allow=never",
    "-c", `protocol.file.allow=${o.allowFile ? "always" : "never"}`,
    ...(dir ? ["-C", dir] : []),
    ...args,
  ];
  let p: ReturnType<typeof Bun.spawn>;
  try {
    p = Bun.spawn(full, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: o.timeoutMs ?? LOCAL_MS,
      killSignal: "SIGKILL",
    });
  } catch {
    throw new GitError("git não encontrado no PATH");
  }
  const [out, err, code] = await Promise.all([new Response(p.stdout as ReadableStream).text(), new Response(p.stderr as ReadableStream).text(), p.exited]);
  if (code !== 0) {
    if (p.signalCode) throw new GitError(`git ${args[0]} excedeu o tempo limite`);
    const why = err.trim().split("\n").filter(Boolean).slice(-1)[0] ?? `saiu com ${code}`;
    throw new GitError(`git ${args[0]} falhou: ${why}`);
  }
  return out;
}

/** Clone without submodules; `ref` (branch, tag or sha) is checked out detached-or-tracking afterwards. */
export async function clone(url: string, dest: string, o: { ref?: string; allowFile?: boolean } = {}): Promise<void> {
  checkUrl(url, o.allowFile);
  if (o.ref?.startsWith("-")) throw new GitError(`ref inválida: \`${o.ref}\``);
  await git(undefined, ["clone", "--no-recurse-submodules", "--", url, dest], { timeoutMs: NET_MS, allowFile: o.allowFile });
  // Keep hooks off for every later git call made by hand in this repo (pull runs post-merge as root).
  await git(dest, ["config", "core.hooksPath", "/dev/null"]);
  if (o.ref) await git(dest, ["checkout", "--quiet", o.ref, "--"]);
}

export const headSha = async (dir: string) => (await git(dir, ["rev-parse", "HEAD"])).trim();
/** Number of changed/untracked paths (`status --porcelain`); 0 = clean. */
export const dirtyCount = async (dir: string) => (await git(dir, ["status", "--porcelain"])).split("\n").filter(Boolean).length;
export const originUrl = async (dir: string) => (await git(dir, ["remote", "get-url", "origin"])).trim();
export const currentRef = async (dir: string) => (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
export const fetch = (dir: string, allowFile?: boolean) => git(dir, ["fetch", "--quiet", "--no-recurse-submodules"], { timeoutMs: NET_MS, allowFile });

/** Counts against the already-fetched upstream (never fetches). Null without an upstream. */
export async function aheadBehind(dir: string): Promise<{ ahead: number; behind: number } | null> {
  try {
    const [a, b] = (await git(dir, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])).trim().split(/\s+/).map(Number);
    return { ahead: a ?? 0, behind: b ?? 0 };
  } catch {
    return null;
  }
}

/** One-line subjects of the commits the upstream has and HEAD lacks. */
export const newCommits = async (dir: string) => (await git(dir, ["log", "--oneline", "HEAD..@{u}"])).split("\n").filter(Boolean);
export const pullFfOnly = (dir: string, allowFile?: boolean) => git(dir, ["pull", "--ff-only", "--no-recurse-submodules"], { timeoutMs: NET_MS, allowFile });
/** True when `dir` is itself a repository root (not a folder inside some other checkout). */
export const isRepoRoot = async (dir: string) => (await git(dir, ["rev-parse", "--show-prefix"]).catch(() => "x")).trim() === "";
