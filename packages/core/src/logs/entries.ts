// The log entries as data: what the Logs tab filters, groups and shows. The files stay text; this only reads them.
import { auditFile } from "../journal/audit.ts";
import { readJsonl } from "../journal/jsonl.ts";
import { readLogs } from "./reader.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";
/** From the quietest to the loudest: a level filter keeps its own level and the ones above. */
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export interface LogEntry {
  /** ms since epoch. */
  at: number;
  level: LogLevel;
  /** The log it came from: a module id, `core` for the host, `audit` for the audit trail. */
  source: string;
  /** The first line of the message. */
  message: string;
  /** The lines that continue it (a stack trace), without their tab. */
  detail: string[];
  /** The entry as the file has it. */
  raw: string;
}

/** `2026-10-15T13:39:04.123Z WARN firewall: text`: the timestamp, the level and the name of the logger, then the message. */
const ENTRY = /^(\S+) (DEBUG|INFO|WARN|ERROR) ([a-z0-9-]+): (.*)$/;
const LEVEL_OF: Record<string, LogLevel> = { DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error" };

/** One entry as `readLogs` returns it (the first line and its tab-indented continuations); undefined for a line that is not an entry. */
export function parseLogEntry(raw: string): LogEntry | undefined {
  const [first = "", ...rest] = raw.split("\n");
  const match = ENTRY.exec(first);
  if (!match) return undefined;
  const at = Date.parse(match[1]!);
  if (Number.isNaN(at)) return undefined;
  return { at, level: LEVEL_OF[match[2]!]!, source: match[3]!, message: match[4]!, detail: rest.map((line) => line.replace(/^\t/, "")), raw };
}

/** How many entries a read keeps: the newest. */
export const DEFAULT_LOG_ENTRIES = 2000;

/** The entries of every log (core and each module, rotated files included), oldest first, at most `tail`. */
export function readLogEntries(logsDir: string, tail = DEFAULT_LOG_ENTRIES): LogEntry[] {
  return readLogs({ logsDir, modules: "all", tail }).flatMap((raw) => parseLogEntry(raw) ?? []);
}

/** The audit trail as one more log: `source` is `audit`. */
interface AuditEvent {
  at: string;
  kind?: string;
  user?: string;
  from?: string;
  line?: string;
  exit?: number;
  text?: string;
}

/** `firewall apply · saiu 1`, `login de operador (192.0.2.10)`, or the text of a module or job event. */
function auditMessage(event: AuditEvent): string {
  if (event.kind === "login") return `login de ${event.user ?? "?"}${event.from ? ` (${event.from})` : ""}`;
  if (event.kind === "cmd") return `${event.user ?? "?"}: ${event.line ?? ""}${event.exit ? ` · saiu ${event.exit}` : ""}`;
  return `${event.user ?? "?"}: ${event.text ?? event.kind ?? ""}`;
}

/** A command that failed is a warning; everything else the trail records is information. */
const auditLevel = (event: AuditEvent): LogLevel => (event.kind === "cmd" && event.exit ? "warn" : "info");

export function readAuditEntries(limit = DEFAULT_LOG_ENTRIES): LogEntry[] {
  return readJsonl<AuditEvent>(auditFile(), { limit })
    .map((event): LogEntry => ({ at: Date.parse(event.at), level: auditLevel(event), source: "audit", message: auditMessage(event), detail: [], raw: JSON.stringify(event) }))
    .reverse(); // readJsonl is newest first
}

/** The job a log line belongs to: the module and the name of the job. */
export interface JobRef {
  module: string;
  name: string;
}

/** A job's own lines in its module's log (`[job backup] ...`), and the start and stop the host writes there (`job backup iniciado: ...`). */
const MODULE_JOB_LINE = /^(?:\[job ([a-z0-9-]+)\]|job ([a-z0-9-]+)(?: iniciado|: parada pedida))/;
/** The same start and stop in the core log, which names the module (`job firewall: job revert iniciado: ...`). */
const CORE_JOB_LINE = /^job ([a-z0-9-]+): job ([a-z0-9-]+)(?: iniciado|: parada pedida)/;

export function jobOfEntry(entry: Pick<LogEntry, "source" | "message">): JobRef | undefined {
  if (entry.source === "core") {
    const core = CORE_JOB_LINE.exec(entry.message);
    return core ? { module: core[1]!, name: core[2]! } : undefined;
  }
  const own = MODULE_JOB_LINE.exec(entry.message);
  const name = own?.[1] ?? own?.[2];
  return name ? { module: entry.source, name } : undefined;
}
