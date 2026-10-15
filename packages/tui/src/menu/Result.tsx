import { useSyncExternalStore } from "react";
import { matchKey } from "../keymap.ts";
import { useScreenScope } from "../router.tsx";
import { useKeys } from "../keys.tsx";
import { BlockView } from "../session/Blocks.tsx";
import type { SessionApi } from "../session/store.ts";
import { Crumb } from "./Crumb.tsx";

const noop = () => {};

/** Output of the block a menu item just ran. enter or esc goes back. The block is also in the session scrollback. */
export function Result({ store, id, onBack }: { store: Pick<SessionApi, "subscribe" | "getSnapshot">; id: number; onBack: () => void }) {
  const { blocks } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useScreenScope("result", 1);
  const b = blocks.find((x) => x.id === id);
  useKeys((k) => {
    if (k.name === "escape" || matchKey(k, "enter")) return onBack(), true;
  });
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1}>
      <Crumb parts={["módulos", "resultado"]} />
      <scrollbox flexGrow={1} minHeight={0} focused={false}>
        {b ? <BlockView b={b} focused={false} tick={0} onPick={noop} /> : null}
      </scrollbox>
    </box>
  );
}
