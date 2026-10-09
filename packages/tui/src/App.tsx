import { useState, type ReactNode } from "react";
import type { Logger } from "@pvx/sdk";
import { KeyRouter, useKeys } from "./keys.tsx";
import { MIN_COLS, MIN_ROWS, useLayout } from "./layout.ts";
import { RouterProvider, ScreenOutlet, useRouter, type Screen } from "./router.tsx";
import { Footer, HelpOverlay } from "./Shortcuts.tsx";
import { ThemeProvider, useTheme } from "./theme-context.tsx";

export interface AppProps {
  /** First screen of the stack. */
  root: Screen;
  logger: Logger;
  /** Called on Ctrl+C after the state is flushed. The host destroys the renderer and exits. */
  onExit: () => void;
  /** Chips for the top strip (widgets); optional. */
  chips?: ReactNode;
  /** Override of `$PVX_HOME/tui-state.json` (tests). */
  statePath?: string;
}

function Frame({ chips }: { chips?: ReactNode }) {
  const { c, result } = useTheme();
  const { depth, pop, notice, scope } = useRouter();
  const { cols, rows } = useLayout();
  const [help, setHelp] = useState(false);
  useKeys((k) => {
    if (k.name === "escape" && depth > 1) return pop(), true;
    if (k.sequence === "?") return setHelp(true), true;
  }, { base: true });

  if (cols < MIN_COLS || rows < MIN_ROWS) {
    return <text fg={c.warn}>{`terminal pequeno: mínimo ${MIN_COLS}x${MIN_ROWS}`}</text>;
  }
  const n = notice ? result("error") : null;
  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={c.bg} paddingX={1}>
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1} flexShrink={1} minWidth={0} overflow="hidden">{chips}</box>
        {n ? <text fg={n.color}>{`${n.marker} ${notice}`}</text> : <text fg={c.dim}>pvx</text>}
      </box>
      <box flexGrow={1} minHeight={0} flexDirection="column">
        <ScreenOutlet />
        {help ? <HelpOverlay onClose={() => setHelp(false)} /> : null}
      </box>
      <Footer scope={scope} />
    </box>
  );
}

function Root({ onExit, chips }: Pick<AppProps, "onExit" | "chips">) {
  const theme = useTheme();
  return (
    <KeyRouter onQuit={() => (theme.flush(), onExit())}>
      <Frame chips={chips} />
    </KeyRouter>
  );
}

/** App frame: chip strip, current screen, footer shortcut line. Esc pops, Ctrl+C exits. */
export function App({ root, logger, onExit, chips, statePath }: AppProps) {
  return (
    <ThemeProvider statePath={statePath}>
      <RouterProvider root={root} logger={logger}>
        <Root onExit={onExit} chips={chips} />
      </RouterProvider>
    </ThemeProvider>
  );
}
