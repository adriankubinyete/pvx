import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger, OutLine } from "@pvx/sdk";
import { secretEnv } from "../palette/form.ts";
import { execute, requiresRoot, type CoreLine, resolveCommand, rootMessage, tokenize, type Registry } from "@pvx/core";

export const MAX_BLOCKS = 500;
const MAX_HISTORY = 500;

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
}

/** A question the host asks the user; answered with `answer`. */
export type Pending = { id: number; kind: "confirm"; cmd: string } | { id: number; kind: "secret"; name: string };

export interface SessionState {
  blocks: readonly Block[];
  history: readonly string[];
  pending: readonly Pending[];
}

export interface SessionApi {
  readonly blocks: readonly Block[];
  readonly history: readonly string[];
  /** Never rejects: a throw becomes an error block. `!!` runs the last history entry. */
  run(line: string, opts?: { secrets?: Record<string, string> }): Promise<{ exit: number }>;
  /** Runs a core command on the side: no block, no history (the core tabs). Same root rule as `run`. */
  capture(line: string): Promise<{ exit: number; lines: CoreLine[] }>;
  /** Re-runs a block; a secret is asked again through the modal. */
  repeat(blockId: number): Promise<{ exit: number }>;
  /** The line to recall for a block: the real one (memory only) when the shown one is masked. */
  lineOf(blockId: number): string;
  clear(): void;
  /** Answers a pending confirm (boolean) or secret (string, or undefined to cancel). */
  answer(id: number, value: boolean | string | undefined): void;
  subscribe(fn: () => void): () => void;
  getSnapshot(): SessionState;
}

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
  /** Runs the core commands (`plano`, `logs`...) that are not in the registry. */
  core?: (argv: string[]) => Promise<{ exit: number; lines: CoreLine[] }>;
}

export function createSessionStore(opts: SessionOpts): SessionApi {
  const { registry, makeLogger, historyPath, isRoot, core } = opts;
  let state: SessionState = { blocks: [], history: loadHistory(historyPath), pending: [] };
  const subs = new Set<() => void>();
  const waiting = new Map<number, (v: boolean | string | undefined) => void>();
  let seq = 0;
  // Real lines of masked blocks. Memory only: the masked line is all that reaches blocks, history and disk.
  const raws = new Map<number, string>();
  let lastRaw: string | undefined;
  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  };
  const patchBlock = (id: number, p: Partial<Block>) => set({ blocks: state.blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const ask = <T extends boolean | string | undefined>(q: { kind: "confirm"; cmd: string } | { kind: "secret"; name: string }) =>
    new Promise<T>((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve as (v: boolean | string | undefined) => void);
      set({ pending: [...state.pending, { ...q, id } as Pending] });
    });

  async function run(raw: string, ro: { secrets?: Record<string, string> } = {}): Promise<{ exit: number }> {
    let line = raw.trim();
    if (line === "!!") line = lastRaw ?? state.history.at(-1) ?? "";
    if (!line) return { exit: 0 };
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
      const confirmed = !denied && found?.cmd.destructive ? await ask<boolean>({ kind: "confirm", cmd: found.key }) : false;
      if (denied) lines = [{ kind: "error", text: rootMessage() }];
      else if (found?.cmd.destructive && !confirmed) lines = [{ kind: "warning", text: "cancelado" }];
      else {
        const r = !found && core && argv.length
          ? await core(argv)
          : await execute(registry, line, {
              makeLogger,
              confirmed,
              env: ro.secrets ? { ...process.env, ...secretEnv(ro.secrets) } : undefined,
              readStdin: async () => "",
              promptSecret: (name) => ask<string | undefined>({ kind: "secret", name }),
            });
        ({ exit, lines } = r);
      }
    } catch (e) {
      lines = [{ kind: "error", text: `erro interno: ${(e as Error).message ?? e}` }];
    }
    const status = exit !== 0 ? "error" : lines.some((l) => l.kind === "warning") ? "warn" : "ok";
    const clean = lines.flatMap((l) => sanitize(l.text).map((text) => ({ kind: l.kind, text })));
    patchBlock(id, { status, ms: Date.now() - t0, lines: clean });
    return { exit };
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
    repeat: async (id) => {
      const b = state.blocks.find((x) => x.id === id);
      return b ? run(raws.get(id) ?? b.line) : { exit: 1 };
    },
    lineOf: (blockId) => raws.get(blockId) ?? state.blocks.find((x) => x.id === blockId)?.line ?? "",
    clear: () => set({ blocks: [] }),
    answer(id, value) {
      waiting.get(id)?.(value);
      waiting.delete(id);
      set({ pending: state.pending.filter((p) => p.id !== id) });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
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
