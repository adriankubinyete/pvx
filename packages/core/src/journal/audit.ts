import { join } from "node:path";
import { pvxHome } from "../engine/paths.ts";
import type { SessionInfo } from "@pvx/sdk";
import { hostSession } from "../host/ssh.ts";
import { appendJsonl, currentUser } from "./jsonl.ts";

export const auditFile = () => join(pvxHome(), "audit.jsonl");

export interface AuditCmd {
  line: string;
  exit: number;
  ms: number;
  destructive: boolean;
  /** Where the SSH client comes from. Default: the host session. Read only when the event is written. */
  session?: SessionInfo;
}

/** An audit write must never break the command that triggered it (a non-root reader has no write access). */
function write(event: object) {
  try {
    appendJsonl(auditFile(), { v: 1, at: new Date().toISOString(), ...event });
  } catch {}
}

/** `{ from }` when the operator came in over SSH, nothing on a console. */
function originOf(session: SessionInfo = hostSession): { from?: string } {
  const ip = session.sshClient;
  return ip ? { from: ip } : {};
}

/** Joins argv back into a line, quoting what has spaces. */
export const lineOf = (argv: string[]) => argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");

/**
 * The host calls this after every executed command. Default scope (decision Q2): destructive commands and core mutations
 * (`mutation`); `PVX_AUDIT=all` records everything. `line` must already be masked.
 */
export function auditCommand(e: AuditCmd, o: { mutation?: boolean } = {}): void {
  if (!o.mutation && !e.destructive && process.env.PVX_AUDIT !== "all") return;
  const { session, ...command } = e;
  write({ kind: "cmd", user: currentUser(), ...command, ...originOf(session) });
}

/** Called by the login banner: who came in and from where (`SSH_CLIENT`). Always recorded. */
export const auditLogin = (user: string, from?: string): void => write({ kind: "login", user, ...(from ? { from } : {}) });

/** Module lifecycle (add, update, trust, remove...): always recorded. */
export const auditModule = (text: string): void => write({ kind: "module", user: currentUser(), text, ...originOf() });

/** Background job start and stop: always recorded. */
export const auditJob = (text: string): void => write({ kind: "job", user: currentUser(), text });
