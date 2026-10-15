import { useEffect, useState } from "react";
import { logsDir, readAuditEntries, readLogEntries, type LogEntry } from "@pvx/core";

/** How often the Logs tab reads the files again while it is shown. */
export const LOGS_REFRESH_MS = 2000;

/** Two reads are the same when they hold as many entries and end in the same one: the logs only grow at the end. */
const signature = (entries: readonly LogEntry[]): string => `${entries.length}|${entries[0]?.raw}|${entries.at(-1)?.raw}`;

const read = (audit: boolean): LogEntry[] => (audit ? readAuditEntries() : readLogEntries(logsDir()));

/** Every log of the central merged (or the audit trail), oldest first, read again every `refreshMs` while mounted. */
export function useLogEntries(audit: boolean, refreshMs: number = LOGS_REFRESH_MS): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>(() => read(audit));
  useEffect(() => {
    const refresh = () => setEntries((current) => {
      const next = read(audit);
      return signature(current) === signature(next) ? current : next;
    });
    refresh();
    const timer = setInterval(refresh, refreshMs);
    return () => clearInterval(timer);
  }, [audit, refreshMs]);
  return entries;
}
