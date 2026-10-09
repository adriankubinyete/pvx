import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Logger } from "@pvx/sdk";
import type { Scope } from "./keymap.ts";
import { useTheme } from "./theme-context.tsx";

export interface Screen {
  id: string;
  /** Footer shortcuts come from this scope (default `session`). */
  scope?: Scope;
  element: ReactNode;
}

/** A screen's footer scope. The highest `rank` wins, the latest among equals: a view inside a tab outranks the tab. */
export interface Claim {
  scope: Scope;
  rank: number;
}

export interface RouterApi {
  top: Screen;
  depth: number;
  push(screen: Screen): void;
  /** Goes back one level; no-op at the root. */
  pop(): void;
  /** Last crash message, cleared on the next push or pop. */
  notice: string | null;
  /** Scope of the footer: an open overlay's (`useFooterScope`), else the one the screen set (`useScreenScope`), else the top screen's. */
  scope: Scope;
  setOverlay(scope: Scope | null): void;
  claim(c: Claim): void;
  release(c: Claim): void;
}

const Ctx = createContext<RouterApi | null>(null);

export function useRouter(): RouterApi {
  const r = useContext(Ctx);
  if (!r) throw new Error("useRouter fora do RouterProvider");
  return r;
}

/** While mounted, the footer shows `scope` instead of the screen's. Does nothing outside a RouterProvider. */
export function useFooterScope(scope: Scope) {
  const set = useContext(Ctx)?.setOverlay;
  useEffect(() => (set?.(scope), () => set?.(null)), [set, scope]);
}

/** A screen whose footer depends on its state: the scope applies while it is mounted, and an overlay still wins. `rank` 1 for a view inside a tab (form, result, session). */
export function useScreenScope(scope: Scope, rank = 0) {
  const api = useContext(Ctx);
  const { claim, release } = api ?? {};
  useEffect(() => {
    const c = { scope, rank };
    claim?.(c);
    return () => release?.(c);
  }, [claim, release, scope, rank]);
}

type Entry = Screen & { uid: number };

/** `fallback` replaces the default crash view (a pane inside a tab shows its error inline). */
export class Boundary extends Component<{ onCatch(err: Error): void; fallback?: (err: Error) => ReactNode; children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  override componentDidCatch(err: Error) {
    this.props.onCatch(err);
  }
  override render() {
    const { err } = this.state;
    return err ? this.props.fallback?.(err) ?? <CrashView err={err} /> : this.props.children;
  }
}

/** Shown only when the root screen crashes (nothing to go back to). */
function CrashView({ err }: { err: Error }) {
  const { c, result } = useTheme();
  const r = result("error");
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={r.color}>{`${r.marker} ${err.message}`}</text>
      <text fg={c.dim}>{err.stack ?? ""}</text>
    </box>
  );
}

export function RouterProvider({ root, logger, children }: { root: Screen; logger: Logger; children: ReactNode }) {
  const uid = useRef(0);
  const [stack, setStack] = useState<Entry[]>(() => [{ ...root, uid: 0 }]);
  const [notice, setNotice] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Scope | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const claim = useCallback((c: Claim) => setClaims((l) => [...l, c]), []);
  const release = useCallback((c: Claim) => setClaims((l) => l.filter((x) => x !== c)), []);
  const screenScope = claims.reduce<Claim | null>((best, c) => (!best || c.rank >= best.rank ? c : best), null)?.scope;
  const push = useCallback((s: Screen) => {
    setNotice(null);
    setStack((st) => [...st, { ...s, uid: ++uid.current }]);
  }, []);
  const pop = useCallback(() => {
    setNotice(null);
    setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
  }, []);
  const top = stack[stack.length - 1]!;
  /** Logs, then returns to the previous screen and leaves a notice. */
  const crash = (e: Entry, err: Error) => {
    logger.error(`tela "${e.id}" falhou: ${err.stack ?? err.message}`);
    if (stack.length < 2) return;
    setStack((st) => st.filter((x) => x !== e));
    setNotice(`tela "${e.id}" falhou: ${err.message}`);
  };
  return (
    <Ctx.Provider value={{ top, depth: stack.length, push, pop, notice, scope: overlay ?? screenScope ?? top.scope ?? "session", setOverlay, claim, release }}>
      <Outlet.Provider value={(
        <Boundary key={top.uid} onCatch={(err) => crash(top, err)}>
          {top.element}
        </Boundary>
      )}>
        {children}
      </Outlet.Provider>
    </Ctx.Provider>
  );
}

const Outlet = createContext<ReactNode>(null);

/** Renders the current screen inside its error boundary. Place it in the main area of the frame. */
export function ScreenOutlet() {
  return <>{useContext(Outlet)}</>;
}
