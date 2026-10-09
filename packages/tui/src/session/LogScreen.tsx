import { useEffect, useState } from "react";
import { logsDir, readLogs } from "@pvx/core";
import { useTheme } from "../theme-context.tsx";
import { sanitize } from "./store.ts";

/** Tail of one module's log, refreshed every second. Esc goes back (frame). */
export function LogScreen({ moduleId }: { moduleId: string }) {
  const { c, box, g } = useTheme();
  const read = () => readLogs({ logsDir: logsDir(), modules: [moduleId], tail: 200 }).flatMap(sanitize);
  const [lines, setLines] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setLines(read()), 1000);
    return () => clearInterval(t);
  }, [moduleId]);
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} log ${moduleId}`}>
      <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" focused={false}>
        {lines.length ? lines.map((l, i) => <text key={i} fg={c.dim}>{l}</text>) : <text fg={c.dim}>sem registros</text>}
      </scrollbox>
    </box>
  );
}
