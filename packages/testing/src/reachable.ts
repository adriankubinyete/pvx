import { unreachableButtons } from "@pvx/tui";

/**
 * Fails when a mounted `Button` has no key and no focus (only the mouse reaches it). Call it after the frame under test is up.
 * Fix: give the button `keys`, or draw it as a row the page's arrows reach (`focused`), or move it into a `Fields` form.
 */
export function expectButtonsReachable(): void {
  const orphans = unreachableButtons();
  if (orphans.length) throw new Error(`botão sem teclado: ${orphans.map((label) => `[ ${label} ]`).join(", ")}. Dê \`keys\` ou \`focused\` ao botão (UI.md, seção 14).`);
}
