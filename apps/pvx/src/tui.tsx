import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { activeProfile, CORE, pvxHome, runCapture, trustGate, watchDevModules, type CliIO } from "@pvx/core";
import { App, createSessionStore, createTabsNav, Tabs, ui } from "@pvx/tui";
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
  // Dev links reload on save; a load error goes to the scrollback as an error block (the old version stays registered).
  const stopWatch = watchDevModules(
    registry,
    ({ id, result }) => store.notice(`recarga de ${id}`, result.ok ? "ok" : "error", [{ kind: result.ok ? "success" : "error", text: result.ok ? result.text : `${id}: ${result.error}` }], id),
    { hostVersion: version, makeLogger, ui },
  );
  // Live load after trust/update/enable: same gate as the startup load, so nothing unapproved is ever imported.
  const modules = {
    load: { hostVersion: version, makeLogger, ui, canImport: trustGate({ warn: (m) => makeLogger("core").warn(m) }) },
    reserved: [...new Set(CORE.map((c) => c.key.split(" ")[0]!))],
  };
  const profile = (await activeProfile(io.profilesDir, io.env))?.title ?? null;
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const closed = new Promise<void>((resolve) => renderer.once("destroy", resolve));
  const root = { id: "tabs", scope: "menu" as const, element: <Tabs store={store} registry={registry} nav={createTabsNav()} version={version} profile={profile} modules={modules} /> };
  createRoot(renderer).render(<App root={root} logger={makeLogger("core")} onExit={() => renderer.destroy()} palette={{ session: store, registry }} pages={{ session: store, registry, makeLogger }} />);
  await closed;
  stopWatch();
}
