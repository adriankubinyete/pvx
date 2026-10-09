import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger, OutLine } from "@pvx/sdk";
import { secretEnv } from "../palette/form.ts";
import { execute, resolveCommand, tokenize, type Registry } from "@pvx/core";

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
  repeat(blockId: number): Promise<{ exit: number }>;
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

export function createSessionStore(opts: { registry: Registry; makeLogger: (name: string) => Logger; historyPath: string }): SessionApi {
  const { registry, makeLogger, historyPath } = opts;
  let state: SessionState = { blocks: [], history: loadHistory(historyPath), pending: [] };
  const subs = new Set<() => void>();
  const waiting = new Map<number, (v: boolean | string | undefined) => void>();
  let seq = 0;
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
    if (line === "!!") line = state.history.at(-1) ?? "";
    if (!line) return { exit: 0 };
    const shown = maskLine(registry, line);
    const id = ++seq;
    const t0 = Date.now();
    let found: ReturnType<typeof resolveCommand>;
    try {
      found = resolveCommand(registry, tokenize(line));
    } catch {}
    const block: Block = { id, line: shown, status: "running", moduleId: found?.cmd.moduleId ?? "core", lines: [] };
    set({ blocks: [...state.blocks, block].slice(-MAX_BLOCKS) });
    addHistory(shown);

    let exit = 1;
    let lines: OutLine[];
    try {
      const confirmed = found?.cmd.destructive ? await ask<boolean>({ kind: "confirm", cmd: found.key }) : false;
      if (found?.cmd.destructive && !confirmed) lines = [{ kind: "warning", text: "cancelado" }];
      else {
        const r = await execute(registry, line, {
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
    repeat: async (blockId) => {
      const b = state.blocks.find((x) => x.id === blockId);
      return b ? run(b.line) : { exit: 1 };
    },
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
