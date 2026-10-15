import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConfirmOptions, Logger, OutLine, SessionInfo } from "@pvx/sdk";
import { secretEnv } from "../palette/form.ts";
import { interactiveProgram, spawnShell, type ShellRun } from "./shell.ts";
import { auditCommand, execute, requiresRoot, type CoreLine, resolveCommand, resolvePage, rootMessage, tokenize, type Registry } from "@pvx/core";

export const MAX_BLOCKS = 500;
const MAX_HISTORY = 500;
/** A host shell block keeps its newest lines only: a flood of output costs memory and renders; the full output belongs in a file. */
const MAX_SHELL_LINES = 2000;
const SHELL_TIMEOUT_MS = 5 * 60_000;

export interface Block {
  id: number;
  /** Masked: a secret never reaches the scrollback. */
  line: string;
  status: "running" | "ok" | "warn" | "error";
  /** Undefined while running. */
  ms?: number;
  moduleId: string;
  lines: OutLine[];
  /** When it started (ms); absent on synthetic blocks. */
  at?: number;
  /** A running host shell command: `cancel(id)` can kill it. Module commands run in-process and cannot be aborted. */
  cancellable?: boolean;
}

/** A question the host asks the user; answered with `answer`. */
export type Pending =
  | ({ id: number; kind: "confirm" } & ConfirmOptions)
  | { id: number; kind: "secret"; name: string }
  | { id: number; kind: "choice"; title: string; lines: string[]; options: string[] };

/** Handed to an `act` body so it can ask the user mid-run. */
export interface ActHelper {
  /** Resolves with the chosen option index (escape picks 0). */
  choose(title: string, lines: string[], options: string[]): Promise<number>;
}

export interface SessionState {
  blocks: readonly Block[];
  history: readonly string[];
  pending: readonly Pending[];
}

export interface SessionApi {
  readonly blocks: readonly Block[];
  readonly history: readonly string[];
  /** Never rejects: a throw becomes an error block. `!!` runs the last history entry. */
  run(line: string, opts?: { secrets?: Record<string, string>; stdin?: string }): Promise<{ exit: number }>;
  /** Runs a core command on the side: no block, no history (the core tabs). Same root rule as `run`. */
  capture(line: string): Promise<{ exit: number; lines: CoreLine[] }>;
  /** Re-runs a block; a secret is asked again through the modal. */
  repeat(blockId: number): Promise<{ exit: number }>;
  /** The line to recall for a block: the real one (memory only) when the shown one is masked. */
  lineOf(blockId: number): string;
  clear(): void;
  /** Kills the running `!cmd` of that block, or all of them without an id; false when none was running. */
  cancel(blockId?: number): boolean;
  /** Pushes a synthetic block (host news such as a dev-module reload error); no history, no run. */
  notice(line: string, status: Block["status"], lines: OutLine[], moduleId?: string): void;
  /**
   * A host mutation (trust, update, remove, add...) as a block, so it reaches the scrollback like any command: same strict root
   * rule, `confirm` asks the host question first. `line` is the CLI line it stands for. `fn` gets a helper to ask the user a choice. Never rejects.
   */
  act(line: string, fn: (h: ActHelper) => Promise<{ exit: number; lines: OutLine[] }>, o?: { confirm?: boolean }): Promise<{ exit: number; id: number }>;
  /** Asks the technician to confirm something in a centered dialog (the same one a destructive command uses). Resolves true on the confirm button. */
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** Answers a pending confirm (boolean), secret (string, or undefined to cancel) or choice (option index). */
  answer(id: number, value: boolean | string | number | undefined): void;
  subscribe(fn: () => void): () => void;
  /** Called with a page key ("<module>.<name>") when `#page` is run or a command with `page` finishes ok. The App's page host pushes the screen. */
  onPage(fn: (key: string) => void): () => void;
  getSnapshot(): SessionState;
}

/** The question before a destructive command runs. */
const destructiveCommandQuestion = (key: string): ConfirmOptions => ({ title: `rodar ${key}?`, description: "este comando é destrutivo", destructive: true });

/** The question before a host mutation (trust, update, remove...) runs. */
const hostActionQuestion = (line: string): ConfirmOptions => ({ title: `rodar ${line}?`, destructive: true });

/** Strips ANSI/control chars (OpenTUI would print them literally) and splits on newlines. */
export function sanitize(text: string): string[] {
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\t/g, "  ")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "")
    .split("\n");
}

/** Commands with a secret arg keep only the path: whatever followed may be the secret. */
export function maskLine(registry: Registry, line: string): string {
  let argv: string[];
  try {
    argv = tokenize(line);
  } catch {
    const [first = "", ...rest] = line.split(/\s+/);
    return rest.length ? `${first} ***` : first;
  }
  const f = resolveCommand(registry, argv);
  if (!f?.cmd.args?.some((a) => a.secret) || argv.length === f.n) return line;
  return `${argv.slice(0, f.n).join(" ")} ***`;
}

export interface SessionOpts {
  registry: Registry;
  makeLogger: (name: string) => Logger;
  historyPath: string;
  /** Real uid 0 (strict root: injected so tests can pass true). */
  isRoot: boolean;
  /** `ctx.session` of the commands the store runs. Default: the real host session (tests hand a fixed one). */
  session?: SessionInfo;
  /** Runs the core commands (`plano`, `logs`...) that are not in the registry. */
  core?: (argv: string[]) => Promise<{ exit: number; lines: CoreLine[] }>;
  /** Limit of a `!cmd` host shell command. Default 5 minutes. */
  shellTimeoutMs?: number;
}

export function createSessionStore(opts: SessionOpts): SessionApi {
  const { registry, makeLogger, historyPath, isRoot, session, core, shellTimeoutMs = SHELL_TIMEOUT_MS } = opts;
  const shells = new Map<number, ShellRun>();
  let state: SessionState = { blocks: [], history: loadHistory(historyPath), pending: [] };
  const subs = new Set<() => void>();
  const pageSubs = new Set<(key: string) => void>();
  const waiting = new Map<number, (v: boolean | string | number | undefined) => void>();
  let seq = 0;
  // Real lines of masked blocks. Memory only: the masked line is all that reaches blocks, history and disk.
  const raws = new Map<number, string>();
  let lastRaw: string | undefined;
  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  };
  const patchBlock = (id: number, p: Partial<Block>) => set({ blocks: state.blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const ask = <T extends boolean | string | number | undefined>(q: Pending extends infer P ? (P extends Pending ? Omit<P, "id"> : never) : never) =>
    new Promise<T>((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve as (v: boolean | string | number | undefined) => void);
      set({ pending: [...state.pending, { ...q, id } as Pending] });
    });

  async function run(raw: string, ro: { secrets?: Record<string, string>; stdin?: string } = {}): Promise<{ exit: number }> {
    let line = raw.trim();
    if (line === "!!") line = lastRaw ?? state.history.at(-1) ?? "";
    if (!line) return { exit: 0 };
    if (line.startsWith("!")) return runShell(line);
    // `#page` is navigation, not a command: no block and no history. An unknown page falls through to an error block.
    const page = line.startsWith("#") ? resolvePage(registry, line.slice(1).trim()) : undefined;
    if (page) return pageSubs.forEach((f) => f(page.key)), { exit: 0 };
    const shown = maskLine(registry, line);
    const id = ++seq;
    const t0 = Date.now();
    let argv: string[] = [];
    try {
      argv = tokenize(line);
    } catch {}
    const found = resolveCommand(registry, argv);
    if (shown !== line) raws.set(id, line);
    lastRaw = shown !== line ? line : undefined;
    const block: Block = { id, line: shown, status: "running", moduleId: found?.cmd.moduleId ?? "core", lines: [], at: t0 };
    set({ blocks: [...state.blocks, block].slice(-MAX_BLOCKS) });
    addHistory(shown);

    let exit = 1;
    let lines: OutLine[];
    try {
      const denied = !isRoot && requiresRoot(registry, argv);
      const confirmed = !denied && found?.cmd.destructive ? await ask<boolean>({ kind: "confirm", ...destructiveCommandQuestion(found.key) }) : false;
      if (denied) lines = [{ kind: "error", text: rootMessage() }];
      else if (line.startsWith("#")) lines = [{ kind: "error", text: `página não encontrada: ${line.slice(1).trim()}` }];
      else if (found?.cmd.destructive && !confirmed) lines = [{ kind: "warning", text: "cancelado" }];
      else {
        const r = !found && core && argv.length
          ? await core(argv)
          : await execute(registry, line, {
              makeLogger,
              confirmed,
              isRoot,
              session,
              env: ro.secrets ? { ...process.env, ...secretEnv(ro.secrets) } : undefined,
              readStdin: async () => ro.stdin ?? "",
              promptSecret: (name) => ask<string | undefined>({ kind: "secret", name }),
            });
        ({ exit, lines } = r);
      }
    } catch (e) {
      lines = [{ kind: "error", text: `erro interno: ${(e as Error).message ?? e}` }];
    }
    settle(id, t0, exit, lines);
    const opens = found && exit === 0 && found.cmd.page ? `${found.cmd.moduleId}.${found.cmd.page}` : undefined;
    if (opens && registry.pages.has(opens)) pageSubs.forEach((f) => f(opens));
    return { exit };
  }

  /** `!cmd`: a host shell command (`/bin/sh -c`), streamed into a block. Runs as the invoking user (no privilege gain), so no root check; audited when the audit file is writable. */
  async function runShell(line: string): Promise<{ exit: number }> {
    const cmd = line.slice(1).trim();
    if (!cmd) return { exit: 0 };
    line = `!${cmd}`;
    const id = ++seq;
    const t0 = Date.now();
    lastRaw = undefined; // `!!` repeats this line, not an older masked one
    set({ blocks: [...state.blocks, { id, line, status: "running", moduleId: "core", lines: [], at: t0, cancellable: true } as Block].slice(-MAX_BLOCKS) });
    addHistory(line);
    const out: OutLine[] = [];
    let exit = 1;
    const interactive = interactiveProgram(cmd);
    if (interactive) out.push({ kind: "error", text: `\`${interactive}\` precisa de um terminal interativo e aqui não há TTY: rode-o fora do pvx` });
    else {
      const rest = { out: "", err: "" };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => (timer = undefined, patchBlock(id, { lines: [...out] }));
      const push = (stderr: boolean, text: string) => {
        for (const t of sanitize(text)) out.push({ kind: stderr ? "warning" : "plain", text: t });
        if (out.length > MAX_SHELL_LINES) out.splice(0, out.length - MAX_SHELL_LINES);
        timer ??= setTimeout(flush, 50);
      };
      let run: ShellRun;
      try {
        run = spawnShell(cmd, shellTimeoutMs, (text, stderr) => {
          const key = stderr ? "err" : "out";
          const parts = (rest[key] + text).split("\n");
          rest[key] = parts.pop()!;
          if (parts.length) push(stderr, parts.join("\n"));
        });
      } catch (e) {
        // The session fires `run` and forgets it: unhandled, this prints a stack over the screen and the block never settles.
        settle(id, t0, 1, [{ kind: "error", text: `não foi possível abrir o shell do host: ${(e as Error).message}` }]);
        return { exit: 1 };
      }
      shells.set(id, run);
      const r = await run.done;
      shells.delete(id);
      clearTimeout(timer);
      for (const stderr of [false, true]) if (rest[stderr ? "err" : "out"]) push(stderr, rest[stderr ? "err" : "out"]);
      clearTimeout(timer);
      exit = r.exit;
      if (r.reason === "timeout") out.push({ kind: "error", text: `tempo esgotado (${Math.round(shellTimeoutMs / 1000)}s): processo morto` });
      if (r.reason === "cancel") out.push({ kind: "error", text: "encerrado pelo usuário" });
      if (exit !== 0) for (const l of out) if (l.kind === "warning") l.kind = "error"; // stderr of a failed command
      auditCommand({ line, exit, ms: Date.now() - t0, destructive: false }, { mutation: true }); // the host shell is the widest door; auditCommand swallows a write failure (non-root)
    }
    settle(id, t0, exit, out);
    return { exit };
  }

  /** Closes a running block: status from the exit code and the lines, output sanitized. */
  function settle(id: number, t0: number, exit: number, lines: OutLine[]) {
    const status = exit !== 0 ? "error" : lines.some((l) => l.kind === "warning") ? "warn" : "ok";
    const clean = lines.flatMap((l) => sanitize(l.text).map((text) => ({ kind: l.kind, text })));
    patchBlock(id, { status, ms: Date.now() - t0, lines: clean });
  }

  async function act(line: string, fn: (h: ActHelper) => Promise<{ exit: number; lines: OutLine[] }>, o: { confirm?: boolean } = {}) {
    const id = ++seq;
    const t0 = Date.now();
    set({ blocks: [...state.blocks, { id, line, status: "running", moduleId: "core", lines: [], at: t0 } as Block].slice(-MAX_BLOCKS) });
    let r: { exit: number; lines: OutLine[] };
    try {
      if (!isRoot) r = { exit: 1, lines: [{ kind: "error", text: rootMessage() }] };
      else if (o.confirm && !(await ask<boolean>({ kind: "confirm", ...hostActionQuestion(line) }))) r = { exit: 1, lines: [{ kind: "warning", text: "cancelado" }] };
      else (r = await fn({ choose: (title, lines, options) => ask<number>({ kind: "choice", title, lines, options }) })), auditCommand({ line, exit: r.exit, ms: Date.now() - t0, destructive: false }, { mutation: true }); // only what actually ran
    } catch (e) {
      r = { exit: 1, lines: [{ kind: "error", text: `erro interno: ${(e as Error).message ?? e}` }] };
    }
    settle(id, t0, r.exit, r.lines);
    return { exit: r.exit, id };
  }

  async function capture(line: string): Promise<{ exit: number; lines: CoreLine[] }> {
    let r: { exit: number; lines: CoreLine[] };
    try {
      const argv = tokenize(line);
      if (!isRoot && requiresRoot(registry, argv)) r = { exit: 1, lines: [{ kind: "error", text: rootMessage() }] };
      else r = core ? await core(argv) : { exit: 1, lines: [{ kind: "error", text: "sem núcleo" }] };
    } catch (e) {
      r = { exit: 1, lines: [{ kind: "error", text: `erro interno: ${(e as Error).message ?? e}` }] };
    }
    return { exit: r.exit, lines: r.lines.flatMap((l) => sanitize(l.text).map((text) => ({ ...l, text }))) };
  }

  function addHistory(line: string) {
    if (state.history.at(-1) === line) return;
    const history = [...state.history, line].slice(-MAX_HISTORY);
    set({ history });
    try {
      mkdirSync(dirname(historyPath), { recursive: true });
      if (history.length < MAX_HISTORY) appendFileSync(historyPath, `${line}\n`);
      else writeFileSync(historyPath, `${history.join("\n")}\n`);
    } catch {}
  }

  return {
    get blocks() {
      return state.blocks;
    },
    get history() {
      return state.history;
    },
    run,
    capture,
    act,
    repeat: async (id) => {
      const b = state.blocks.find((x) => x.id === id);
      return b ? run(raws.get(id) ?? b.line) : { exit: 1 };
    },
    lineOf: (blockId) => raws.get(blockId) ?? state.blocks.find((x) => x.id === blockId)?.line ?? "",
    clear: () => set({ blocks: [] }),
    cancel: (id) => {
      const rs = id === undefined ? [...shells.values()] : [shells.get(id)].filter((r) => r);
      rs.forEach((r) => r!.cancel());
      return rs.length > 0;
    },
    notice(line, status, lines, moduleId = "core") {
      const clean = lines.flatMap((l) => sanitize(l.text).map((text) => ({ kind: l.kind, text })));
      set({ blocks: [...state.blocks, { id: ++seq, line, status, moduleId, lines: clean }].slice(-MAX_BLOCKS) });
    },
    confirm: (options) => ask<boolean>({ kind: "confirm", ...options }),
    answer(id, value) {
      waiting.get(id)?.(value);
      waiting.delete(id);
      set({ pending: state.pending.filter((p) => p.id !== id) });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    onPage(fn) {
      pageSubs.add(fn);
      return () => void pageSubs.delete(fn);
    },
    getSnapshot: () => state,
  };
}

function loadHistory(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}
