import { useState } from "react";
import type { Logger } from "@pvx/sdk";
import { PaletteHost, type PaletteProps } from "./palette/Palette.tsx";
import { KeyRouter, useKeys } from "./keys.tsx";
import { MIN_COLS, MIN_ROWS, useLayout } from "./layout.ts";
import { PageHost, PagesCtx, type PageDeps } from "./sdk-ui/index.tsx";
import { RouterProvider, ScreenOutlet, useRouter, type Screen } from "./router.tsx";
import { Footer, HelpOverlay } from "./Shortcuts.tsx";
import { NudgeProvider } from "./nudge.tsx";
import { ThemeProvider, useTheme } from "./theme-context.tsx";

export interface AppProps {
  /** First screen of the stack. */
  root: Screen;
  logger: Logger;
  /** Called on Ctrl+C after the state is flushed. The host destroys the renderer and exits. */
  onExit: () => void;
  /** Session and registry for the command palette (ctrl+k, from every screen). Without it there is no palette. */
  palette?: Omit<PaletteProps, "onClose">;
  /** Session, registry and loggers for module pages (`#page`, a command's `page`, page tabs). Without it pages do not open. */
  pages?: PageDeps;
  /** Override of `$PVX_HOME/tui-state.json` (tests). */
  statePath?: string;
}

function Frame({ palette, pages }: Pick<AppProps, "palette" | "pages">) {
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
      {n ? <text fg={n.color} flexShrink={0}>{`${n.marker} ${notice}`}</text> : null}
      <box flexGrow={1} minHeight={0} flexDirection="column">
        <ScreenOutlet />
        {help ? <HelpOverlay scope={scope} onClose={() => setHelp(false)} /> : null}
        {palette ? <PaletteHost {...palette} /> : null}
        {pages ? <PageHost /> : null}
      </box>
      <Footer scope={scope} />
    </box>
  );
}

function Root({ onExit, palette, pages }: Pick<AppProps, "onExit" | "palette" | "pages">) {
  const theme = useTheme();
  return (
    <KeyRouter onQuit={() => (theme.flush(), onExit())}>
      <Frame palette={palette} pages={pages} />
    </KeyRouter>
  );
}

/** App frame: current screen, footer shortcut line. Esc pops, Ctrl+C exits. */
export function App({ root, logger, onExit, palette, pages, statePath }: AppProps) {
  return (
    <ThemeProvider statePath={statePath}>
      <RouterProvider root={root} logger={logger}>
        <PagesCtx.Provider value={pages ?? null}>
          <NudgeProvider>
            <Root onExit={onExit} palette={palette} pages={pages} />
          </NudgeProvider>
        </PagesCtx.Provider>
      </RouterProvider>
    </ThemeProvider>
  );
}
