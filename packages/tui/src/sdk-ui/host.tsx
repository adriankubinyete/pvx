import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createStore, resolveCommand, tokenize, type Registry } from "@pvx/core";
import type { CommandRun, Conformity, KeySpec, Logger, SdkUi } from "@pvx/sdk";
import type { SessionApi } from "../session/store.ts";
import { conformityOf, conformityView } from "../tabs/conformity.ts";
import { useTheme } from "../theme-context.tsx";

/** What the page hooks need from the host. Provided once by `App` (`pages` prop). */
export interface PageDeps {
  session: Pick<SessionApi, "run" | "capture" | "subscribe" | "getSnapshot" | "onPage" | "answer">;
  registry: Registry;
  makeLogger: (name: string) => Logger;
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
}
export const HostCtx = createContext<HostPage | null>(null);
/** True at the page root: a `Panel` there is the page's own frame (the host's border and title), not a second border. */
export const RootPanelCtx = createContext(false);

export function useHost(): HostPage {
  const h = useContext(HostCtx);
  if (!h) throw new Error("hook de sdk.ui usado fora de uma página");
  return h;
}

/** Runs one line of this module through the session and reads back what it printed. Throws if the line is another module's command. */
export async function runOwn(h: HostPage, line: string, secrets?: Record<string, string>): Promise<CommandRun> {
  const { session, registry } = h.deps;
  const found = resolveCommand(registry, tokenize(line));
  if (found && found.cmd.moduleId !== h.moduleId) throw new Error(`uma página só roda comandos do próprio módulo: "${found.key}" é de "${found.cmd.moduleId}"`);
  const p = session.run(line, { secrets });
  const id = session.getSnapshot().blocks.at(-1)?.id; // run adds its block synchronously
  const { exit } = await p;
  return { exit, lines: session.getSnapshot().blocks.find((b) => b.id === id)?.lines ?? [] };
}

function useCommand(line: string) {
  const h = useHost();
  const [state, setState] = useState<{ running: boolean; lastResult?: CommandRun }>({ running: false });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, running: true }));
    try {
      const lastResult = await runOwn(h, line);
      setState({ running: false, lastResult });
      return lastResult;
    } catch (e) {
      setState((s) => ({ ...s, running: false }));
      throw e;
    }
  }, [h, line]);
  return { run, ...state };
}

function useQuery<T = unknown>(name: string, ...args: unknown[]) {
  const { deps } = useHost();
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const argsKey = JSON.stringify(args);
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    Promise.resolve()
      .then(() => deps.registry.query(name, ...args))
      .then((data) => live && setState({ data: data as T, loading: false }), (e) => live && setState({ error: (e as Error).message, loading: false }));
    return () => void (live = false);
  }, [deps, name, argsKey]);
  return state;
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
function useKey(keys: string, label: string, handler: () => void) {
  const { addKey } = useHost();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => addKey({ keys, label, run: () => latest.current() }), [addKey, keys, label]);
}

function useConformity(): Conformity {
  const { deps } = useHost();
  const store = conformityOf(deps.session);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => ({ ...conformityView(snap), refresh: store.refresh, apply: store.apply }), [snap, store]);
}

function useModuleTheme() {
  const { c, g } = useTheme();
  return { c, g };
}

export const hooks: Pick<SdkUi, "useCommand" | "useQuery" | "useStore" | "useRouter" | "useKey" | "useConformity" | "useTheme"> = {
  useCommand, useQuery, useStore, useRouter, useKey, useConformity, useTheme: useModuleTheme,
};
