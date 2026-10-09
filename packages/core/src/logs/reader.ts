import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LogQuery {
  logsDir: string;
  /** Module names (core included), or "all". Default "all". */
  modules?: string[] | "all";
  tail?: number;
}

export interface FollowOptions extends LogQuery {
  pollMs?: number;
  /** Entries newer than now-holdMs wait, so slow-polled files can't reorder output. */
  holdMs?: number;
}

interface Entry {
  ts: string; // ISO, sorts lexicographically
  text: string; // whole entry, continuation lines included
}

const logFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
  } catch {
    return [];
  }
};

const selected = (q: LogQuery): string[] =>
  !q.modules || q.modules === "all" ? logFiles(q.logsDir) : q.modules.map((m) => `${m}.log`);

/** Lines -> entries; a tab-indented line continues the previous entry. */
function parse(lines: string[]): Entry[] {
  const out: Entry[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (l.startsWith("\t") && last) last.text += `\n${l}`;
    else out.push({ ts: l.slice(0, 24), text: l });
  }
  return out;
}

// Array.sort is stable.
const byTs = (a: Entry, b: Entry) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);

/** Merged entries (current file plus rotated backups), last `tail` of them. */
export function readLogs(q: LogQuery): string[] {
  const entries: Entry[] = [];
  for (const f of selected(q)) {
    for (const p of [3, 2, 1, 0]) {
      const path = join(q.logsDir, p ? `${f}.${p}` : f);
      if (existsSync(path)) entries.push(...parse(readFileSync(path, "utf8").split("\n").filter(Boolean)));
    }
  }
  entries.sort(byTs);
  return (q.tail === undefined ? entries : entries.slice(-q.tail)).map((e) => e.text);
}

interface FileState {
  ino: number;
  offset: number;
  buf: Buffer;
}

/**
 * Follow by file offset. Files present at start are followed from their end
 * (use readLogs for history); files created later are read from 0.
 * Resolves when `signal` aborts.
 */
export function followLogs(q: FollowOptions, onLine: (entry: string) => void, signal: AbortSignal): Promise<void> {
  const { pollMs = 100, holdMs = 300 } = q;
  const files = new Map<string, FileState>();
  let pending: Entry[] = [];

  const poll = (initial: boolean) => {
    for (const f of selected(q)) {
      const path = join(q.logsDir, f);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      let s = files.get(f);
      if (!s) {
        s = { ino: st.ino, offset: initial ? st.size : 0, buf: Buffer.alloc(0) };
        files.set(f, s);
      } else if (st.ino !== s.ino || st.size < s.offset) {
        s.ino = st.ino; // rotated: restart at 0
        s.offset = 0;
        s.buf = Buffer.alloc(0);
      }
      if (st.size === s.offset) continue;
      const chunk = Buffer.alloc(st.size - s.offset);
      const fd = openSync(path, "r");
      const n = readSync(fd, chunk, 0, chunk.length, s.offset);
      closeSync(fd);
      s.offset += n;
      const data = Buffer.concat([s.buf, chunk.subarray(0, n)]);
      const nl = data.lastIndexOf(10);
      s.buf = Buffer.from(data.subarray(nl + 1)); // partial line stays buffered
      if (nl >= 0) pending.push(...parse(data.subarray(0, nl).toString("utf8").split("\n").filter(Boolean)));
    }
  };

  const flush = (all: boolean) => {
    pending.sort(byTs);
    const cutoff = new Date(Date.now() - holdMs).toISOString();
    let i = 0;
    while (i < pending.length && (all || pending[i]!.ts <= cutoff)) onLine(pending[i++]!.text);
    pending = pending.slice(i);
  };

  poll(true);
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      poll(false);
      flush(false);
    }, pollMs);
    signal.addEventListener(
      "abort",
      () => {
        clearInterval(timer);
        poll(false);
        flush(true);
        resolve();
      },
      { once: true },
    );
    if (signal.aborted) signal.dispatchEvent(new Event("abort"));
  });
}
