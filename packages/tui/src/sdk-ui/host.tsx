import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createJobs, createStore, resolveCommand, rootMessage, tokenize, type Registry } from "@pvx/core";
import { phasesKey } from "@pvx/core";
import type { CommandRun, Conformity, JobState, JobStatus, JobView, KeySpec, Logger, PhasesState, QueryState, RunState, RunView, SdkUi } from "@pvx/sdk";
import type { SessionApi } from "../session/store.ts";
import { conformityOf, conformityView } from "../tabs/conformity.ts";
import { useNudge as useHostNudge } from "../nudge.tsx";
import { usePanelNav } from "../panelnav.ts";
import { useTabs } from "../tabs/context.ts";
import { useLayout } from "../layout.ts";
import { useTheme } from "../theme-context.tsx";
import { DEFAULT_STALE_MS, isCurrentRun, jobViewOf, progressOf, runViewOf, stepsOf } from "./run.ts";

/** What the page hooks need from the host. Provided once by `App` (`pages` prop). */
export interface PageDeps {
  session: Pick<SessionApi, "run" | "capture" | "subscribe" | "getSnapshot" | "onPage" | "answer">;
  registry: Registry;
  makeLogger: (name: string) => Logger;
  /** Real uid 0 (the session's rule): `useJob().start` and `stop` need it. */
  isRoot?: boolean;
}
export const PagesCtx = createContext<PageDeps | null>(null);
export const usePages = () => useContext(PagesCtx);

/** The page being rendered: which module owns it, and its router. Provided by `PageContent`. */
export interface HostPage {
  moduleId: string;
  deps: PageDeps;
  push(name: string): void;
  pop(): void;
  /** Adds a key to the page (`useKey`); returns the remover. Reserved keys are ignored. */
  addKey(spec: KeySpec): () => void;
  /** Adds an esc handler (`useBack`); returns the remover. Undefined `current`: not active. */
  addBack(entry: BackEntry): () => void;
}
/** One mounted `useBack`; the page keeps them in mount order. */
export type BackEntry = { current: (() => void) | undefined };
/** The esc handler to run: the most recently mounted `useBack` that has a function. */
export const activeBack = (backs: readonly BackEntry[]) => backs.findLast((b) => b.current)?.current;
/** Lets a tab pane share its back list with the page inside, so one esc rule serves both. */
export const BackCtx = createContext<BackEntry[] | null>(null);
export const HostCtx = createContext<HostPage | null>(null);
/** Whether the page receives keys now (`usePageFocused`). Separate from `HostCtx` so a focus change does not re-register keys. */
export const FocusCtx = createContext(false);
/** True at the page root: a `Panel` there is the page's own frame (the host's border and title), not a second border. */
export const RootPanelCtx = createContext(false);

export function useHost(): HostPage {
  const h = useContext(HostCtx);
  if (!h) throw new Error("hook de sdk.ui usado fora de uma página");
  return h;
}

/** One argument as the tokenizer reads it back: double quotes, with `\\` and `\"` escaped. */
const quoteArg = (a: string) => (/^[\w.:/=@%+,-]+$/.test(a) ? a : `"${a.replace(/[\\"]/g, "\\$&")}"`);

/** Runs one line of this module through the session and reads back what it printed. Throws if the line is another module's command. */
export async function runOwn(h: HostPage, line: string, secrets?: Record<string, string>, stdin?: string): Promise<CommandRun> {
  const { session, registry } = h.deps;
  const found = resolveCommand(registry, tokenize(line));
  if (found && found.cmd.moduleId !== h.moduleId) throw new Error(`uma página só roda comandos do próprio módulo: "${found.key}" é de "${found.cmd.moduleId}"`);
  const p = session.run(line, { secrets, stdin });
  const id = session.getSnapshot().blocks.at(-1)?.id; // run adds its block synchronously
  const { exit } = await p;
  return { exit, lines: session.getSnapshot().blocks.find((b) => b.id === id)?.lines ?? [] };
}

function useCommand(line: string) {
  const h = useHost();
  const [state, setState] = useState<{ running: boolean; lastResult?: CommandRun }>({ running: false });
  const run = useCallback(async (opts?: { args?: string[]; stdin?: string }) => {
    setState((s) => ({ ...s, running: true }));
    try {
      const lastResult = await runOwn(h, [line, ...(opts?.args ?? []).map(quoteArg)].join(" "), undefined, opts?.stdin);
      setState({ running: false, lastResult });
      return lastResult;
    } catch (e) {
      setState((s) => ({ ...s, running: false }));
      throw e;
    }
  }, [h, line]);
  return { run, ...state };
}

const sameJson = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/** `useQuery(name, ...args)` or `useQuery(name, args, { refreshMs })`: the second form re-runs on an interval (min 500 ms) and keeps the old data meanwhile. `refetch()` reads again now. */
function useQuery<T = unknown>(name: string, ...rest: unknown[]): QueryState<T> {
  const { deps } = useHost();
  const opts = rest.length === 2 && Array.isArray(rest[0]) && typeof (rest[1] as { refreshMs?: unknown } | null)?.refreshMs === "number" ? (rest[1] as { refreshMs: number }) : undefined;
  const args = opts ? (rest[0] as unknown[]) : rest;
  const every = opts ? Math.max(500, opts.refreshMs) : 0;
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const refetchNow = useRef<() => Promise<void>>(async () => {});
  const argsKey = JSON.stringify(args);
  useEffect(() => {
    let live = true;
    let busy = false;
    let again = false;
    const read = async (first: boolean): Promise<void> => {
      if (first) setState({ loading: true });
      try {
        const data = (await deps.registry.query(name, ...args)) as T;
        if (live) setState((current) => (!first && !current.error && !current.loading && sameJson(current.data, data) ? current : { data, loading: false }));
      } catch (error) {
        const message = (error as Error).message;
        if (live) setState((current) => (first ? { error: message, loading: false } : { data: current.data, error: message, loading: false }));
      }
    };
    /** A poll skips while a read is out; a `refetch` asked meanwhile reads once more after it, since that one may predate the change. */
    const run = async (first: boolean, forced: boolean): Promise<void> => {
      if (busy) {
        again = again || forced;
        return;
      }
      busy = true;
      await read(first);
      busy = false;
      if (again && live) {
        again = false;
        await run(false, false);
      }
    };
    refetchNow.current = () => run(false, true);
    void run(true, false);
    const timer = every ? setInterval(() => void run(false, false), every) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [deps, name, argsKey, every]);
  const refetch = useCallback(() => refetchNow.current(), []);
  return { ...state, refetch };
}

/** Polls the job `name` every second; the page re-renders only when the status, the tail or the stale flag changed. */
function useJob(name: string, opts?: { tail?: number; staleMs?: number }): JobState {
  const { moduleId, deps } = useHost();
  const tail = opts?.tail ?? 200;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const jobs = useMemo(() => createJobs(moduleId), [moduleId]);
  const [snap, setSnap] = useState<{ status: JobStatus; lines: string[]; view: JobView; loading: boolean }>({ status: { state: "none" }, lines: [], view: "idle", loading: true });
  const poll = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let live = true;
    let lastContent = "";
    let lastView = "";
    let answered = false;
    let changedAt = Date.now();
    poll.current = async () => {
      const [status, lines] = await Promise.all([jobs.status(name), jobs.log(name, { tail })]);
      const content = JSON.stringify([status, lines]);
      if (content !== lastContent) changedAt = Date.now();
      const view = jobViewOf(status, Date.now() - changedAt, staleMs);
      if (!live || (answered && content === lastContent && view === lastView)) return;
      answered = true;
      lastContent = content;
      lastView = view;
      setSnap({ status, lines, view, loading: false });
    };
    void poll.current();
    const timer = setInterval(() => void poll.current(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [jobs, name, tail, staleMs]);
  const root = () => {
    if (!deps.isRoot) throw new Error(rootMessage());
  };
  return {
    ...snap,
    async start(line: string, o?: { secrets?: Record<string, string> }) {
      root();
      await jobs.start(name, line, o);
      await poll.current();
    },
    async stop() {
      root();
      await jobs.stop(name);
      await poll.current();
    },
  };
}

/** The phases a command keeps in the store (`ctx.phases.run(name, ...)`), polled every second; the page re-renders only when they changed. */
function usePhasesState(name: string): PhasesState | undefined {
  const { moduleId } = useHost();
  const store = useMemo(() => createStore(moduleId), [moduleId]);
  const [state, setState] = useState<PhasesState | undefined>(() => store.get<PhasesState>(phasesKey(name)));
  useEffect(() => {
    const read = () => {
      const next = store.get<PhasesState>(phasesKey(name));
      setState((current) => (sameJson(current, next) ? current : next));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [store, name]);
  return state;
}

const NOW_TICK_MS = 1000;

/** The current time, read again every second while `active`: it is what makes the elapsed time of a running step advance. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const RUNNING_VIEWS: RunView[] = ["running", "stale"];

/** A phased run: the job `name` plus its phases. */
function useRun(name: string, opts?: { tail?: number; staleMs?: number; trailing?: string[] }): RunState {
  const { view: jobView, ...job } = useJob(name, opts);
  const state = usePhasesState(name);
  const current = isCurrentRun(state, job.status);
  const shown = current ? state : undefined;
  const view = runViewOf(jobView, state, current, opts?.trailing, job.loading);
  const now = useNow(RUNNING_VIEWS.includes(view));
  return { ...job, jobView, view, state, current, steps: stepsOf(shown, now), progress: progressOf(shown) };
}

function useStore() {
  const { moduleId } = useHost();
  return useMemo(() => createStore(moduleId), [moduleId]);
}

/** Module pages only: a name resolves inside the module. */
function useRouter() {
  const { push, pop } = useHost();
  return { push, pop };
}

/** Pages call it in render, so `handler` closes over the component state; the host registers it while mounted. */
export function useKey(keys: string, label: string, handler: () => void, opts?: { help?: boolean }) {
  const { addKey } = useHost();
  const latest = useRef(handler);
  latest.current = handler;
  const help = opts?.help;
  useEffect(() => addKey({ keys, label, help, run: () => latest.current() }), [addKey, keys, label, help]);
}

function useConformity(): Conformity {
  const { deps } = useHost();
  const store = conformityOf(deps.session);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => ({ ...conformityView(snap), refresh: store.refresh, apply: store.apply }), [snap, store]);
}

/** While mounted with a function, esc calls it (and stays on the page) instead of leaving. */
function useBack(fn?: () => void) {
  const { addBack } = useHost();
  const entry = useRef<BackEntry>({ current: fn });
  entry.current.current = fn;
  useEffect(() => addBack(entry.current), [addBack]);
}

/** Panel navigation plus `toBar`, which focuses the tab bar (no-op outside the tabs). */
function usePanelsHost() {
  const nav = usePanelNav();
  const tabs = useTabs();
  const latest = useRef(tabs);
  latest.current = tabs;
  return useMemo(() => ({ ...nav, toBar: () => latest.current?.focusBar() }), [nav]);
}

/** True while the page receives keys: its tab is active with the bar not focused, or it is the top pushed screen. */
function usePageFocused() {
  useHost();
  return useContext(FocusCtx);
}

function useViewport() {
  const { cols, rows } = useLayout();
  return { cols, rows };
}

function useModuleTheme() {
  const { c, g } = useTheme();
  return { c, g };
}

export const hooks: Pick<SdkUi, "useCommand" | "useQuery" | "useJob" | "useRun" | "useStore" | "useRouter" | "useKey" | "useNudge" | "useBack" | "useConformity" | "useTheme" | "useViewport" | "usePanels" | "usePageFocused"> = {
  useCommand, useQuery: useQuery as SdkUi["useQuery"], useJob, useRun, useStore, useRouter, useKey, useBack, useNudge: useHostNudge, useConformity, useViewport, usePanels: usePanelsHost, usePageFocused, useTheme: useModuleTheme,
};
