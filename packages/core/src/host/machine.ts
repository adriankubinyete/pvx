import { statfsSync } from "node:fs";
import { cpus, freemem, loadavg, networkInterfaces, totalmem, uptime } from "node:os";

export interface Machine {
  /** 1-minute load average. */
  load: number;
  cpus: number;
  /** 0..100 */
  ramPct: number;
  /** 0..100, of the filesystem holding `/`. */
  diskPct: number;
  /** Seconds. */
  uptime: number;
}

/** Cheap and synchronous (no shell-outs): safe to call every few seconds. */
export function readMachine(diskPath = "/"): Machine {
  let diskPct = 0;
  try {
    const s = statfsSync(diskPath);
    diskPct = s.blocks ? ((s.blocks - s.bavail) / s.blocks) * 100 : 0;
  } catch {}
  return {
    load: loadavg()[0] ?? 0,
    cpus: cpus().length || 1,
    ramPct: ((totalmem() - freemem()) / totalmem()) * 100,
    diskPct,
    uptime: uptime(),
  };
}

/** First non-internal IPv4 address, if any. */
export function primaryIp(): string | undefined {
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
}
