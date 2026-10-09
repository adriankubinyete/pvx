import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

export const ROTATE_BYTES = 5 * 1024 * 1024;
const BACKUPS = 3;
const CHUNK = 64 * 1024;

/** Who acts: the sudo caller, else the login name. */
export const currentUser = (env: Record<string, string | undefined> = process.env) => env.SUDO_USER || env.LOGNAME || "desconhecido";

/** `file` -> `file.1` -> `file.2` -> `file.3`; the oldest is dropped. */
function rotate(file: string) {
  rmSync(`${file}.${BACKUPS}`, { force: true });
  for (let i = BACKUPS - 1; i >= 1; i--) {
    try {
      renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {}
  }
  renameSync(file, `${file}.1`);
}

/** One append write per event; rotates by size first. Throws on a read-only home: callers that must not fail wrap it. */
export function appendJsonl(file: string, event: object, maxBytes = ROTATE_BYTES): void {
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (statSync(file).size >= maxBytes) rotate(file);
  } catch {}
  appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o644 });
}

/** The lines of a file, last first, reading 64 KB chunks from the end: a reader that stops early never touches the rest. */
function* linesBackward(path: string): Generator<string> {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return;
  }
  try {
    let pos = fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    while (pos > 0 || carry.length) {
      let data = carry;
      if (pos > 0) {
        const n = Math.min(CHUNK, pos);
        pos -= n;
        const buf = Buffer.alloc(n);
        readSync(fd, buf, 0, n, pos);
        data = Buffer.concat([buf, carry]);
      }
      const cut = pos > 0 ? data.indexOf(10) : -1;
      if (pos > 0 && cut < 0) {
        carry = data;
        continue;
      }
      carry = pos > 0 ? data.subarray(0, cut) : Buffer.alloc(0);
      const body = data.subarray(cut + 1).toString("utf8").split("\n");
      for (let i = body.length - 1; i >= 0; i--) if (body[i]) yield body[i]!;
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Events of a jsonl, newest first, through the rotated backups. Files are append-only, so time only goes backward here:
 * the scan stops at the first event older than `sinceMs` (or after `limit` events). Broken lines are skipped.
 */
export function readJsonl<T extends { at?: unknown }>(file: string, o: { sinceMs?: number; limit?: number } = {}): T[] {
  const { sinceMs = -Infinity, limit = Infinity } = o;
  const out: T[] = [];
  for (const path of [file, ...Array.from({ length: BACKUPS }, (_, i) => `${file}.${i + 1}`)]) {
    for (const line of linesBackward(path)) {
      let e: T;
      try {
        e = JSON.parse(line) as T;
      } catch {
        continue;
      }
      if (typeof e?.at !== "string") continue;
      if (Date.parse(e.at) < sinceMs) return out;
      out.push(e);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
