import { Component, createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { Logger } from "@pvx/sdk";
import type { Scope } from "./keymap.ts";
import { useTheme } from "./theme-context.tsx";

export interface Screen {
  id: string;
  /** Footer shortcuts come from this scope (default `session`). */
  scope?: Scope;
  element: ReactNode;
}

export interface RouterApi {
  top: Screen;
  depth: number;
  push(screen: Screen): void;
  /** Goes back one level; no-op at the root. */
  pop(): void;
  /** Last crash message, cleared on the next push or pop. */
  notice: string | null;
}

const Ctx = createContext<RouterApi | null>(null);

export function useRouter(): RouterApi {
  const r = useContext(Ctx);
  if (!r) throw new Error("useRouter fora do RouterProvider");
  return r;
}

type Entry = Screen & { uid: number };

class Boundary extends Component<{ onCatch(err: Error): void; children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  override componentDidCatch(err: Error) {
    this.props.onCatch(err);
  }
  override render() {
    return this.state.err ? <CrashView err={this.state.err} /> : this.props.children;
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
    <Ctx.Provider value={{ top, depth: stack.length, push, pop, notice }}>
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
