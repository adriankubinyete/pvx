import type { Shortcut } from "../keymap.ts";

/** Palette rows in the shape of keymap.ts; keymap.ts merges them into the one `shortcuts` table. */
export const paletteShortcuts: readonly Shortcut[] = [
  { keys: "↑↓", label: "move", scope: "palette" },
  { keys: "tab", label: "formulário", scope: "palette" },
  { keys: "enter", label: "roda", scope: "palette", footer: true },
  { keys: "space", label: "enfileira", scope: "palette", footer: true },
  { keys: "ctrl+n", label: "enfileira (com busca)", scope: "palette" },
  { keys: "ctrl+enter", label: "roda a fila", scope: "palette", footer: true },
  { keys: "ctrl+j", label: "roda a fila (sem kitty)", scope: "palette" },
  { keys: "ctrl+f", label: "favorito", scope: "palette" },
  { keys: "esc", label: "fecha", scope: "palette" },
];
