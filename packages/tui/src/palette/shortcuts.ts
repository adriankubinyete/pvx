import type { Shortcut } from "../keymap.ts";

/** Palette rows in the shape of keymap.ts; the integration step merges them into `shortcuts`. */
export const paletteShortcuts: readonly Shortcut[] = [
  { keys: "↑↓", label: "move", scope: "palette" },
  { keys: "tab", label: "formulário", scope: "palette" },
  { keys: "enter", label: "roda", scope: "palette", footer: true },
  { keys: "space", label: "enfileira", scope: "palette", footer: true },
  { keys: "ctrl+enter", label: "roda a fila", scope: "palette", footer: true },
  { keys: "ctrl+f", label: "favorito", scope: "palette", footer: true },
  { keys: "esc", label: "fecha", scope: "palette" },
];
