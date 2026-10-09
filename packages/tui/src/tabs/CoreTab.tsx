import { useEffect, useSyncExternalStore } from "react";
import { BlockView } from "../session/Blocks.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";

const noop = () => {};

/** Output of a core command (`conformidade`, `plano`, `logs`) in a scrollable view. Runs on every entry, so it is never stale; the block also lands in the Comando scrollback. */
export function CoreTab({ store, line }: { store: SessionApi; line: string }) {
  const { box, g } = useTheme();
  const { blocks } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => void store.run(line), []);
  const b = blocks.findLast((x) => x.line === line);
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} ${line}`}>
      <scrollbox flexGrow={1} minHeight={0} focused>
        {b ? <BlockView b={b} actions={false} tick={0} onPick={noop} /> : null}
      </scrollbox>
    </box>
  );
}
