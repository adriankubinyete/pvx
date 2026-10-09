import { useSyncExternalStore } from "react";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { BlockView } from "../session/Blocks.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";

const noop = () => {};

/** Output of the block a menu item just ran. enter or esc goes back. The block is also in the session scrollback. */
export function Result({ store, id, onBack }: { store: Pick<SessionApi, "subscribe" | "getSnapshot">; id: number; onBack: () => void }) {
  const { c, box, g } = useTheme();
  const { blocks } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const b = blocks.find((x) => x.id === id);
  useKeys((k) => {
    if (k.name === "escape" || matchKey(k, "enter")) return onBack(), true;
  });
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} resultado`}>
      <scrollbox flexGrow={1} minHeight={0} focused={false}>
        {b ? <BlockView b={b} focused={false} tick={0} onPick={noop} /> : null}
      </scrollbox>
      <text fg={c.dim}>{" enter ou esc volta"}</text>
    </box>
  );
}
