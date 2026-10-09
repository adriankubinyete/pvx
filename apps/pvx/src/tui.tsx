import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { activeProfile, pvxHome, runCapture, type CliIO } from "@pvx/core";
import { App, createSessionStore, createTabsNav, Tabs } from "@pvx/tui";
import { join } from "node:path";

/** Opens the TUI on the tabs screen. Resolves after the renderer is destroyed. */
export async function openTui(io: Omit<CliIO, "argv" | "out" | "isTTY">): Promise<void> {
  const { registry, makeLogger, isRoot, version } = io;
  const store = createSessionStore({
    registry,
    makeLogger,
    isRoot,
    historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture(io, argv),
  });
  const profile = (await activeProfile(io.profilesDir, io.env))?.title ?? null;
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const closed = new Promise<void>((resolve) => renderer.once("destroy", resolve));
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version={version} profile={profile} /> };
  createRoot(renderer).render(<App root={root} logger={makeLogger("core")} onExit={() => renderer.destroy()} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />);
  await closed;
}
