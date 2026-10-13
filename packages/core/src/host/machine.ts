import { readFileSync, readdirSync, statfsSync } from "node:fs";
import { cpus, freemem, hostname, loadavg, networkInterfaces, release, totalmem, type, uptime } from "node:os";

/** Cumulative CPU time: `busy` and `total` in any unit, only deltas matter. */
export interface CpuTimes { busy: number; total: number }
export interface Used { used: number; total: number }

export interface MachineSnap {
  at: number;
  host: string;
  ip?: string;
  os: string;
  /** Seconds. */
  uptime: number;
  cpu: {
    /** 0..100 */
    total: number;
    cores: number[];
    load: [number, number, number];
    /** Last samples of `total`, oldest first. */
    history: number[];
  };
  /** Bytes. */
  mem: Used;
  swap?: Used;
  disk?: Used;
  /** Busiest interface, bytes per second. */
  net?: { iface: string; rx: number; tx: number };
  procs?: number;
  /** Top processes by CPU, as % of the whole machine. */
  top?: { name: string; pct: number }[];
}

/** What the sampler reads from `/proc`; tests feed fixtures. `read` gives undefined when the file is missing or denied. */
export interface ProcFs {
  read(path: string): string | undefined;
  list(path: string): string[];
}
export const realFs: ProcFs = {
  read: (p) => { try { return readFileSync(p, "utf8"); } catch {} },
  list: (p) => { try { return readdirSync(p); } catch { return []; } },
};

/** Everything that is not `/proc`: the `os` module and `statfs`. */
export interface Sys {
  hostname(): string;
  ip(): string | undefined;
  type(): string;
  release(): string;
  uptime(): number;
  loadavg(): number[];
  totalmem(): number;
  freemem(): number;
  cpus(): CpuTimes[];
  disk(): Used | undefined;
}
const realSys: Sys = {
  hostname, type, release, uptime, loadavg, totalmem, freemem,
  ip: primaryIp,
  cpus: () => cpus().map(({ times: t }) => ({ busy: t.user + t.nice + t.sys + t.irq, total: t.user + t.nice + t.sys + t.irq + t.idle })),
  disk: () => {
    try {
      const s = statfsSync("/");
      return s.blocks ? { used: (s.blocks - s.bfree) * s.bsize, total: s.blocks * s.bsize } : undefined;
    } catch {}
  },
};

/** `/proc/stat`: the aggregate `cpu` line, then one `cpuN` per core. Idle counts idle + iowait. */
export function parseStat(text: string): { all: CpuTimes; cores: CpuTimes[] } | undefined {
  const lines = text.split("\n").filter((l) => /^cpu\d*\s/.test(l)).map((l) => l.trim().split(/\s+/).slice(1, 9).map(Number));
  const times = (f: number[]): CpuTimes => {
    const total = f.reduce((a, b) => a + b, 0);
    return { busy: total - (f[3] ?? 0) - (f[4] ?? 0), total };
  };
  const [all, ...cores] = lines.map(times);
  return all && cores.length ? { all, cores } : undefined;
}

/** Percent busy between two readings; 0 when the clock did not advance. */
export function cpuPct(prev: CpuTimes | undefined, cur: CpuTimes): number {
  const total = cur.total - (prev?.total ?? 0);
  return total > 0 ? Math.max(0, Math.min(100, ((cur.busy - (prev?.busy ?? 0)) / total) * 100)) : 0;
}

/** `/proc/meminfo` values, in bytes. */
export function parseMeminfo(text: string): { memTotal?: number; memAvail?: number; swapTotal?: number; swapFree?: number } {
  const kb = (k: string) => {
    const m = text.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"));
    return m ? Number(m[1]) * 1024 : undefined;
  };
  return { memTotal: kb("MemTotal"), memAvail: kb("MemAvailable"), swapTotal: kb("SwapTotal"), swapFree: kb("SwapFree") };
}

/** `/proc/net/dev`: received and sent bytes per interface. */
export function parseNetDev(text: string): Record<string, { rx: number; tx: number }> {
  const out: Record<string, { rx: number; tx: number }> = {};
  for (const l of text.split("\n")) {
    const m = l.match(/^\s*([^:\s]+):\s*(.*)$/);
    if (!m) continue;
    const f = m[2]!.trim().split(/\s+/).map(Number);
    if (f.length >= 9) out[m[1]!] = { rx: f[0]!, tx: f[8]! };
  }
  return out;
}

/** The interface (not `lo`) that moved the most bytes since `prev`, as bytes per second; on a tie, the one with the most total. */
export function pickNet(prev: Record<string, { rx: number; tx: number }> | undefined, cur: Record<string, { rx: number; tx: number }>, secs: number) {
  let best: { iface: string; rx: number; tx: number; score: [number, number] } | undefined;
  for (const [iface, v] of Object.entries(cur)) {
    if (iface === "lo") continue;
    const p = prev?.[iface];
    const rx = p && secs > 0 ? Math.max(0, v.rx - p.rx) / secs : 0;
    const tx = p && secs > 0 ? Math.max(0, v.tx - p.tx) / secs : 0;
    const score: [number, number] = [rx + tx, v.rx + v.tx];
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { iface, rx, tx, score };
  }
  return best && { iface: best.iface, rx: best.rx, tx: best.tx };
}

/** `/proc/[pid]/stat`: the name sits in parentheses (and may hold spaces and parentheses), utime and stime follow. */
export function parsePidStat(text: string): { name: string; ticks: number } | undefined {
  const a = text.indexOf("(");
  const b = text.lastIndexOf(")");
  if (a < 0 || b < a) return undefined;
  const f = text.slice(b + 2).split(" ");
  const ticks = Number(f[11]) + Number(f[12]);
  return Number.isFinite(ticks) ? { name: text.slice(a + 1, b), ticks } : undefined;
}

/** Top processes by tick delta, as % of `totalTicks` (the delta of the aggregate CPU line, i.e. the whole machine). Pids without a previous reading are skipped. */
export function topProcs(prev: Map<string, number>, cur: Map<string, { name: string; ticks: number }>, totalTicks: number, n: number): { name: string; pct: number }[] {
  if (totalTicks <= 0) return [];
  const out: { name: string; pct: number }[] = [];
  for (const [pid, p] of cur) {
    const before = prev.get(pid);
    if (before === undefined) continue;
    const pct = (Math.max(0, p.ticks - before) / totalTicks) * 100;
    if (pct > 0) out.push({ name: p.name, pct });
  }
  return out.sort((x, y) => y.pct - x.pct).slice(0, n);
}

export interface MachineSampler {
  /** Reads everything and appends to the history; cheap enough for a 2 s timer. */
  sample(): MachineSnap;
}

export interface SamplerDeps {
  fs?: ProcFs;
  /** Whether `/proc` exists; defaults to the platform. */
  linux?: boolean;
  sys?: Partial<Sys>;
  now?: () => number;
  /** Samples kept for the graph (30 at 2 s is 60 s). */
  history?: number;
}

export function createMachineSampler(deps: SamplerDeps = {}): MachineSampler {
  const fs = deps.fs ?? realFs;
  const linux = deps.linux ?? process.platform === "linux";
  const sys = { ...realSys, ...deps.sys };
  const now = deps.now ?? Date.now;
  const keep = deps.history ?? 30;
  const history: number[] = [];
  let osName: string | undefined;
  let prevAt: number | undefined;
  let prevCpu: { all: CpuTimes; cores: CpuTimes[] } | undefined;
  let prevNet: Record<string, { rx: number; tx: number }> | undefined;
  let prevPids = new Map<string, number>();

  const osPretty = () => osName ??= (linux ? fs.read("/etc/os-release")?.match(/^PRETTY_NAME="?([^"\n]*)"?/m)?.[1] : undefined) ?? `${sys.type()} ${sys.release()}`;

  return {
    sample() {
      const at = now();
      const secs = prevAt === undefined ? 0 : (at - prevAt) / 1000;
      const stat = (linux ? parseStat(fs.read("/proc/stat") ?? "") : undefined) ?? (() => { const c = sys.cpus(); return { all: { busy: c.reduce((a, x) => a + x.busy, 0), total: c.reduce((a, x) => a + x.total, 0) }, cores: c }; })();
      const cores = stat.cores.map((c, i) => cpuPct(prevCpu?.cores[i], c));
      const total = cpuPct(prevCpu?.all, stat.all);
      history.push(total);
      if (history.length > keep) history.shift();

      const mi = linux ? parseMeminfo(fs.read("/proc/meminfo") ?? "") : {};
      const memTotal = mi.memTotal ?? sys.totalmem();
      const mem = { used: memTotal - (mi.memAvail ?? sys.freemem()), total: memTotal };
      const swap = mi.swapTotal !== undefined && mi.swapFree !== undefined ? { used: mi.swapTotal - mi.swapFree, total: mi.swapTotal } : undefined;

      let net: MachineSnap["net"];
      const nd = linux ? fs.read("/proc/net/dev") : undefined;
      if (nd) {
        const cur = parseNetDev(nd);
        net = pickNet(prevNet, cur, secs);
        prevNet = cur;
      }

      let procs: number | undefined;
      let top: MachineSnap["top"];
      if (linux) {
        const pids = fs.list("/proc").filter((p) => /^\d+$/.test(p));
        const cur = new Map<string, { name: string; ticks: number }>();
        for (const pid of pids) {
          const s = fs.read(`/proc/${pid}/stat`); // vanished or denied: skip
          const p = s && parsePidStat(s);
          if (p) cur.set(pid, p);
        }
        procs = pids.length;
        top = topProcs(prevPids, cur, stat.all.total - (prevCpu?.all.total ?? stat.all.total), 5);
        prevPids = new Map([...cur].map(([k, v]) => [k, v.ticks]));
      }

      prevAt = at;
      prevCpu = stat;
      const l = sys.loadavg();
      return {
        at, host: sys.hostname(), ip: sys.ip(), os: osPretty(), uptime: sys.uptime(),
        cpu: { total, cores, load: [l[0] ?? 0, l[1] ?? 0, l[2] ?? 0], history: [...history] },
        mem, swap, disk: sys.disk(), net, procs, top,
      };
    },
  };
}

/** First non-internal IPv4 address, if any. */
export function primaryIp(): string | undefined {
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
}
