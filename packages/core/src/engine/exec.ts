import type { ExecOpts, ExecResult } from "@pvx/sdk";

/** Process groups of the detached children still running: a job stopped by the host kills them too. */
const groups = new Set<number>();
export const killExecGroups = (sig: NodeJS.Signals = "SIGKILL") => {
  for (const g of groups) {
    try {
      process.kill(-g, sig);
    } catch {}
  }
};

/** Splits a stream into lines on `\n`, `\r\n` and lone `\r` (progress bars redraw with `\r`). `push` takes chunks, `end` the last partial line. */
export function lineSplitter(emit: (line: string) => void) {
  let pend = "";
  let cr = false;
  return {
    push(chunk: string) {
      if (cr && chunk.startsWith("\n")) chunk = chunk.slice(1); // the \n of a \r\n cut between two chunks
      const s = pend + chunk;
      cr = chunk.endsWith("\r");
      const parts = s.split(/\r\n|\r|\n/);
      pend = parts.pop()!;
      parts.forEach(emit);
    },
    end() {
      if (pend) emit(pend);
      pend = "";
    },
  };
}

/** The real `ctx.exec` (the permission check is the caller's). A `signal` or a timeout kills the whole process group when `detached`. */
export async function runProgram(cmd: string, args: string[], o: ExecOpts): Promise<ExecResult> {
  const detached = Boolean(o.signal); // its own session: killable as a group; without a signal the child stays in ours (Ctrl+C reaches it)
  const p = Bun.spawn([cmd, ...args], {
    cwd: o.cwd,
    env: { ...process.env, ...o.env },
    stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    detached,
  });
  if (detached) groups.add(p.pid);
  const kill = (sig: NodeJS.Signals) => {
    try {
      detached ? process.kill(-p.pid, sig) : p.kill(sig);
    } catch {}
  };
  const timers: Timer[] = [setTimeout(() => kill("SIGKILL"), o.timeoutMs ?? 30_000)];
  const abort = () => {
    kill("SIGTERM");
    timers.push(setTimeout(() => kill("SIGKILL"), 2000));
  };
  if (o.signal?.aborted) abort();
  else o.signal?.addEventListener("abort", abort, { once: true });

  const keep = o.buffer !== false;
  const read = async (s: ReadableStream, stream: "stdout" | "stderr") => {
    const dec = new TextDecoder();
    const split = lineSplitter((l) => o.onLine?.(l, stream));
    let all = "";
    for await (const chunk of s as AsyncIterable<Uint8Array>) {
      const t = dec.decode(chunk, { stream: true });
      if (keep) all += t;
      if (o.onLine) split.push(t);
    }
    split.end();
    return all;
  };
  try {
    const [stdout, stderr, code] = await Promise.all([read(p.stdout as ReadableStream, "stdout"), read(p.stderr as ReadableStream, "stderr"), p.exited]);
    return { code, stdout, stderr };
  } finally {
    timers.forEach(clearTimeout);
    o.signal?.removeEventListener("abort", abort);
    groups.delete(p.pid);
  }
}
