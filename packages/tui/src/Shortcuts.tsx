import { useSyncExternalStore } from "react";
import { footerFor, helpFor, rowsRev, subscribeRows, type Scope, type Shortcut } from "./keymap.ts";
import { useKeys } from "./keys.tsx";
import { NudgeText, useNoticeOk } from "./nudge.tsx";
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
  useSyncExternalStore(subscribeRows, rowsRev); // a page's `useKey` rows come and go
  const ok = useNoticeOk();
  return (
    <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" overflow="hidden">
      {ok ? null : <Keys list={footerFor(scope)} gap="   " />}
      <NudgeText />
    </box>
  );
}

/** The `?` overlay: every row of the footer's current scope plus the global ones (a short list, so it always fits 80x24). A modal: it owns the keyboard. */
export function HelpOverlay({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const { c, box, g } = useTheme();
  useSyncExternalStore(subscribeRows, rowsRev);
  useKeys((k) => {
    if (k.name === "escape" || k.sequence === "?" || k.name === "q") onClose();
  }, { modal: true });
  return (
    <box position="absolute" top={0} left={2} zIndex={10} flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.accent)} title={`${g.active} ajuda · esc fecha`}>
      {helpFor(scope).map((s) => (
        <text key={s.scope + s.keys}>
          <span fg={c.accent}><b>{s.keys.padEnd(11)}</b></span>
          <span fg={c.text}>{s.label}</span>
        </text>
      ))}
      <text fg={c.dim}>o rodapé mostra só as teclas principais</text>
    </box>
  );
}
