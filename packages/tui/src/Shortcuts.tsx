import { footerFor, shortcuts, type Scope, type Shortcut } from "./keymap.ts";
import { useKeys } from "./keys.tsx";
import { useTheme } from "./theme-context.tsx";

function Keys({ list, gap }: { list: Shortcut[]; gap: string }) {
  const { c } = useTheme();
  return (
    <text>
      {list.map((s, i) => (
        <span key={s.keys + s.scope}>
          <span fg={c.accent}><b>{s.keys}</b></span>
          <span fg={c.dim}>{` ${s.label}${i < list.length - 1 ? gap : ""}`}</span>
        </span>
      ))}
    </text>
  );
}

/** Footer shortcut line for the active scope, rendered from the shortcut table. */
export function Footer({ scope }: { scope: Scope }) {
  return (
    <box height={1} flexShrink={0}>
      <Keys list={footerFor(scope)} gap="   " />
    </box>
  );
}

const titles: Record<Scope, string> = { global: "geral", session: "sessão", palette: "palette" };

/** Two columns, so every scope fits in 80x24. */
const columns: Scope[][] = [["global", "session"], ["palette"]];

/** The `?` overlay: every shortcut in the table, by scope. A modal: it owns the keyboard. */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { c, box, g } = useTheme();
  useKeys((k) => {
    if (k.name === "escape" || k.sequence === "?" || k.name === "q") onClose();
  }, { modal: true });
  return (
    <box position="absolute" top={1} left={2} zIndex={10} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.accent)} title={`${g.active} ajuda`}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        {columns.map((col) => (
          <box key={col[0]} flexDirection="column" flexShrink={0}>
            {col.map((scope) => (
              <box key={scope} flexDirection="column" flexShrink={0}>
                <text fg={c.dim}>{titles[scope]}</text>
                {shortcuts.filter((s) => s.scope === scope).map((s) => (
                  <text key={s.keys}>
                    <span fg={c.accent}><b>{s.keys.padEnd(11)}</b></span>
                    <span fg={c.text}>{s.label}</span>
                  </text>
                ))}
              </box>
            ))}
          </box>
        ))}
      </box>
      <text fg={c.dim}>esc fecha</text>
    </box>
  );
}
