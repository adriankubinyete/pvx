import { expect, test } from "bun:test";
import { cpuPct, createMachineSampler, parseMeminfo, parseNetDev, parsePidStat, parseStat, pickNet, topProcs, type ProcFs } from "../../src/index.ts";

const stat = (a: number[], cores: number[][]) =>
  [a, ...cores].map((f, i) => `${i ? `cpu${i - 1}` : "cpu "} ${f.join(" ")} 0 0 0`).join("\n") + "\nintr 1 2 3\n";

test("cpu percent comes from the delta of two /proc/stat readings (idle and iowait are idle)", () => {
  // user nice system idle iowait irq softirq steal
  const a = parseStat(stat([100, 0, 100, 700, 100, 0, 0, 0], [[50, 0, 50, 350, 50, 0, 0, 0], [50, 0, 50, 350, 50, 0, 0, 0]]))!;
  const b = parseStat(stat([200, 0, 200, 800, 100, 0, 0, 0], [[50, 0, 50, 450, 50, 0, 0, 0], [150, 0, 150, 350, 50, 0, 0, 0]]))!;
  expect(a.cores).toHaveLength(2);
  expect(cpuPct(a.all, b.all)).toBeCloseTo(66.67, 1);
  expect(cpuPct(a.cores[0], b.cores[0]!)).toBe(0);
  expect(cpuPct(a.cores[1], b.cores[1]!)).toBe(100);
  expect(cpuPct(b.all, b.all)).toBe(0); // the clock did not advance
  expect(parseStat("nothing")).toBeUndefined();
});

test("meminfo gives bytes for memory and swap", () => {
  const m = parseMeminfo("MemTotal:  6291456 kB\nMemFree: 1 kB\nMemAvailable:  3000000 kB\nSwapTotal: 2097152 kB\nSwapFree: 2097152 kB\n");
  expect(m).toEqual({ memTotal: 6291456 * 1024, memAvail: 3000000 * 1024, swapTotal: 2097152 * 1024, swapFree: 2097152 * 1024 });
  expect(parseMeminfo("")).toEqual({ memTotal: undefined, memAvail: undefined, swapTotal: undefined, swapFree: undefined });
});

const dev = (rows: Record<string, [number, number]>) =>
  "Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n" +
  Object.entries(rows).map(([n, [rx, tx]]) => `  ${n}: ${rx} 1 0 0 0 0 0 0 ${tx} 1 0 0 0 0 0 0`).join("\n") + "\n";

test("net picks the interface with the most traffic since the last reading, never lo", () => {
  const a = parseNetDev(dev({ lo: [0, 0], eth0: [1000, 1000], eth1: [5000, 0] }));
  expect(a.eth0).toEqual({ rx: 1000, tx: 1000 });
  const b = parseNetDev(dev({ lo: [999999, 999999], eth0: [3000, 1500], eth1: [5100, 0] }));
  expect(pickNet(a, b, 2)).toEqual({ iface: "eth0", rx: 1000, tx: 250 });
  expect(pickNet(undefined, a, 2)).toEqual({ iface: "eth1", rx: 0, tx: 0 }); // no delta yet: most total
  expect(pickNet(a, parseNetDev(dev({ lo: [1, 1] })), 2)).toBeUndefined();
});

const pid = (name: string, u: number, s: number) => `1 (${name}) S 1 1 1 0 -1 0 0 0 0 0 ${u} ${s} 0 0 20 0 1 0 5 0 0\n`;

test("top processes use the tick delta over the machine's ticks; new pids are skipped; names may hold parentheses", () => {
  expect(parsePidStat(pid("a (b) c", 7, 3))).toEqual({ name: "a (b) c", ticks: 10 });
  expect(parsePidStat("garbage")).toBeUndefined();
  const prev = new Map([["1", 100], ["2", 50], ["9", 10]]);
  const cur = new Map([["1", { name: "asterisk", ticks: 160 }], ["2", { name: "mysqld", ticks: 60 }], ["3", { name: "new", ticks: 999 }]]); // 9 vanished
  expect(topProcs(prev, cur, 100, 3)).toEqual([{ name: "asterisk", pct: 60 }, { name: "mysqld", pct: 10 }]);
  expect(topProcs(prev, cur, 0, 3)).toEqual([]);
});

function fakeProc(files: Record<string, string>): ProcFs & { files: Record<string, string> } {
  return {
    files,
    read: (p) => files[p],
    list: (p) => [...new Set(Object.keys(files).filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1).split("/")[0]!))],
  };
}

test("the sampler reads fixtures, keeps a ring of history, and survives a vanished pid", () => {
  const fs = fakeProc({
    "/etc/os-release": 'NAME="Rocky"\nPRETTY_NAME="Rocky Linux 8.10"\n',
    "/proc/stat": stat([0, 0, 0, 0, 0, 0, 0, 0], [[0, 0, 0, 0, 0, 0, 0, 0]]),
    "/proc/meminfo": "MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n",
    "/proc/net/dev": dev({ eth0: [0, 0] }),
    "/proc/1/stat": pid("asterisk", 0, 0),
    "/proc/2/stat": pid("gone", 0, 0),
    "/proc/self/stat": "ignored",
  });
  let t = 1_000;
  const s = createMachineSampler({ fs, linux: true, history: 2, now: () => t, sys: { hostname: () => "h", ip: () => "1.2.3.4", loadavg: () => [1, 2, 3], uptime: () => 60, disk: () => ({ used: 1, total: 2 }) } });
  const first = s.sample();
  expect(first).toMatchObject({ host: "h", ip: "1.2.3.4", os: "Rocky Linux 8.10", procs: 2, top: [], mem: { used: 600 * 1024, total: 1000 * 1024 }, swap: { used: 0, total: 0 } });
  fs.files["/proc/stat"] = stat([60, 0, 0, 40, 0, 0, 0, 0], [[60, 0, 0, 40, 0, 0, 0, 0]]);
  fs.files["/proc/1/stat"] = pid("asterisk", 30, 10);
  delete fs.files["/proc/2/stat"]; // vanished between samples
  fs.files["/proc/net/dev"] = dev({ eth0: [2000, 1000] });
  t += 2_000;
  const b = s.sample();
  expect(b.cpu.total).toBe(60);
  expect(b.cpu.cores).toEqual([60]);
  expect(b.top).toEqual([{ name: "asterisk", pct: 40 }]);
  expect(b.net).toEqual({ iface: "eth0", rx: 1000, tx: 500 });
  fs.files["/proc/stat"] = stat([60, 0, 0, 140, 0, 0, 0, 0], [[60, 0, 0, 140, 0, 0, 0, 0]]);
  expect(s.sample().cpu.history).toEqual([60, 0]); // ring of 2
});

test("without /proc the sampler falls back to os and leaves net, procs and top out", () => {
  const s = createMachineSampler({ linux: false, sys: { cpus: () => [{ busy: 10, total: 20 }, { busy: 0, total: 20 }], totalmem: () => 100, freemem: () => 25, type: () => "Darwin", release: () => "25.0" } });
  const m = s.sample();
  expect(m.cpu.cores).toEqual([50, 0]);
  expect(m.mem).toEqual({ used: 75, total: 100 });
  expect(m.os).toBe("Darwin 25.0");
  expect([m.net, m.procs, m.top, m.swap]).toEqual([undefined, undefined, undefined, undefined]);
});
