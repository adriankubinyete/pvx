import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createLogger, logsDir } from "@pvx/core";
import { App } from "@pvx/tui";

/** Opens the TUI. Resolves after the renderer is destroyed. */
export async function openTui(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const closed = new Promise<void>((resolve) => renderer.once("destroy", resolve));
  const root = { id: "inicio", element: <text>sessão e palette chegam nas próximas etapas</text> };
  createRoot(renderer).render(<App root={root} logger={createLogger(logsDir(), "core")} onExit={() => renderer.destroy()} />);
  await closed;
}
