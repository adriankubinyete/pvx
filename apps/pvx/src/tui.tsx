import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";

function App() {
  const renderer = useRenderer();
  useKeyboard((k) => {
    if (k.name === "q" || (k.ctrl && k.name === "c")) renderer.destroy();
  });
  return <text>pvx.next — TUI na Fase 2 (q sai)</text>;
}

/** Stub until Fase 2. Resolves after the renderer is destroyed. */
export async function openTui(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const closed = new Promise<void>((resolve) => renderer.once("destroy", resolve));
  createRoot(renderer).render(<App />);
  await closed;
}
