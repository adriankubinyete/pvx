import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createLogger, createRegistry, loadModules, logsDir, pvxHome } from "@pvx/core";
import { App, createSessionStore, Session } from "@pvx/tui";
import { join } from "node:path";

/** Opens the TUI. Resolves after the renderer is destroyed. */
export async function openTui(): Promise<void> {
  const registry = createRegistry();
  const makeLogger = (name: string) => createLogger(logsDir(), name);
  await loadModules(registry, { hostVersion: "0.1.0", makeLogger });
  const store = createSessionStore({ registry, makeLogger, historyPath: join(pvxHome(), "tui-history") });
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const closed = new Promise<void>((resolve) => renderer.once("destroy", resolve));
  const root = { id: "sessao", element: <Session store={store} registry={registry} /> };
  createRoot(renderer).render(<App root={root} logger={makeLogger("core")} onExit={() => renderer.destroy()} />);
  await closed;
}
