import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createJobs, createStore, resolveCommand, rootMessage, tokenize, type Registry } from "@pvx/core";
import type { CommandRun, Conformity, JobStatus, KeySpec, Logger, SdkUi } from "@pvx/sdk";
import type { SessionApi } from "../session/store.ts";
import { conformityOf, conformityView } from "../tabs/conformity.ts";
import { useNudge as useHostNudge } from "../nudge.tsx";
import { usePanelNav } from "../panelnav.ts";
import { useTabs } from "../tabs/context.ts";
import { useLayout } from "../layout.ts";
import { useTheme } from "../theme-context.tsx";

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

/** `useQuery(name, ...args)` or `useQuery(name, args, { refreshMs })`: the second form re-runs on an interval (min 500 ms) and keeps the old data meanwhile. */
function useQuery<T = unknown>(name: string, ...rest: unknown[]) {
  const { deps } = useHost();
  const opts = rest.length === 2 && Array.isArray(rest[0]) && typeof (rest[1] as { refreshMs?: unknown } | null)?.refreshMs === "number" ? (rest[1] as { refreshMs: number }) : undefined;
  const args = opts ? (rest[0] as unknown[]) : rest;
  const every = opts ? Math.max(500, opts.refreshMs) : 0;
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const argsKey = JSON.stringify(args);
  useEffect(() => {
    let live = true;
    let busy = false;
    const run = (first: boolean) => {
      if (busy) return;
      busy = true;
      if (first) setState({ loading: true });
      Promise.resolve()
        .then(() => deps.registry.query(name, ...args))
        .then(
          (data) => live && setState((s) => (!first && !s.error && !s.loading && sameJson(s.data, data) ? s : { data: data as T, loading: false })),
          (e) => live && setState((s) => (first ? { error: (e as Error).message, loading: false } : { data: s.data, error: (e as Error).message, loading: false })),
        )
        .finally(() => void (busy = false));
    };
    run(true);
    const timer = every ? setInterval(() => run(false), every) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [deps, name, argsKey, every]);
  return state;
}

/** A job of this module, polled every second; the page re-renders only when the status or the tail changed. */
function useJob(name: string, opts?: { tail?: number }) {
  const { moduleId, deps } = useHost();
  const tail = opts?.tail ?? 200;
  const jobs = useMemo(() => createJobs(moduleId), [moduleId]);
  const [snap, setSnap] = useState<{ status: JobStatus; lines: string[] }>({ status: { state: "none" }, lines: [] });
  const poll = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let live = true;
    let last = "";
    poll.current = async () => {
      const [status, lines] = await Promise.all([jobs.status(name), jobs.log(name, { tail })]);
      const key = JSON.stringify([status, lines]);
      if (!live || key === last) return;
      last = key;
      setSnap({ status, lines });
    };
    void poll.current();
    const timer = setInterval(() => void poll.current(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [jobs, name, tail]);
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
function useKey(keys: string, label: string, handler: () => void, opts?: { help?: boolean }) {
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

export const hooks: Pick<SdkUi, "useCommand" | "useQuery" | "useJob" | "useStore" | "useRouter" | "useKey" | "useNudge" | "useBack" | "useConformity" | "useTheme" | "useViewport" | "usePanels" | "usePageFocused"> = {
  useCommand, useQuery: useQuery as SdkUi["useQuery"], useJob, useStore, useRouter, useKey, useBack, useNudge: useHostNudge, useConformity, useViewport, usePanels: usePanelsHost, usePageFocused, useTheme: useModuleTheme,
};
