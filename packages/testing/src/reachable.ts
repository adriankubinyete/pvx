import { unreachableButtons } from "@pvx/tui";

/**
 * Fails when a mounted `Button` is not in the focus order (only the mouse or a `keys` shortcut reaches it). Call it after the frame under test is up.
 * Fix: draw it as a `ButtonRow` stop, or give the `Button` `focused` and let the page navigate to it. `keys` is an extra shortcut, never the only way.
 */
export function expectButtonsReachable(): void {
  const orphans = unreachableButtons();
  if (orphans.length) throw new Error(`botão fora do foco: ${orphans.map((label) => `[ ${label} ]`).join(", ")}. Use ButtonRow ou dê \`focused\` ao botão; \`keys\` sozinho não basta (UI.md, seção 17).`);
}
