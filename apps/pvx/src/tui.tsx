import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { pvxHome, runCapture, type CliIO } from "@pvx/core";
import { App, createMenuNav, createSessionStore, Menu, ModuleChips } from "@pvx/tui";
import { join } from "node:path";

/** Opens the TUI on the menu screen. Resolves after the renderer is destroyed. */
export async function openTui(io: Omit<CliIO, "argv" | "out" | "isTTY">): Promise<void> {
  const { registry, makeLogger, isRoot, version } = io;
  const store = createSessionStore({
    registry,
    makeLogger,
    isRoot,
    historyPath: join(pvxHome(), "tui-history"),
    core: (argv) => runCapture(io, argv),
  });
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const closed = new Promise<void>((resolve) => renderer.once("destroy", resolve));
  const root = { id: "menu", scope: "menu" as const, element: <Menu store={store} registry={registry} nav={createMenuNav()} version={version} /> };
  createRoot(renderer).render(<App root={root} logger={makeLogger("core")} onExit={() => renderer.destroy()} chips={<ModuleChips registry={registry} />} />);
  await closed;
}
