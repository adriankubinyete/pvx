import { useState } from "react";
import type { Registry } from "@pvx/core";
import { useRouter } from "./router.tsx";
import { LogScreen } from "./session/LogScreen.tsx";
import { clean } from "./palette/search.ts";
import { useTheme } from "./theme-context.tsx";

/** A short label in the top strip. Hover is local state (only this chip repaints); `onClick` is optional. */
export function Chip({ label, color, onClick }: { label: string; color?: string; onClick?: () => void }) {
  const { c } = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <box backgroundColor={hover ? c.selected : c.panel} paddingX={1} flexShrink={0} onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)} onMouseDown={onClick}>
      <text fg={color ?? c.dim}>{clean(label)}</text>
    </box>
  );
}

const MAX_ERRORS = 2; // the strip must fit 80 columns

/** Host chips until module widgets exist (Fase 3): how many modules loaded, and `✗ <id>` per failed one (click opens its log). */
export function ModuleChips({ registry }: { registry: Registry }) {
  const { c, g } = useTheme();
  const router = useRouter();
  const n = registry.modules.size;
  return (
    <>
      <Chip label={`${n} ${n === 1 ? "módulo" : "módulos"}`} />
      {registry.errors.slice(0, MAX_ERRORS).map((e) => (
        <Chip key={e.id} label={`${g.error} ${e.id}`} color={c.error} onClick={() => router.push({ id: "log", element: <LogScreen moduleId={e.id} /> })} />
      ))}
      {registry.errors.length > MAX_ERRORS ? <Chip label={`+${registry.errors.length - MAX_ERRORS}`} color={c.error} /> : null}
    </>
  );
}
