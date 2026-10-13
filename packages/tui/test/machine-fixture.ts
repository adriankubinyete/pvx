import type { MachineSnap } from "@pvx/core";

const G = 2 ** 30;
export const snap = (cores = 8, over: Partial<MachineSnap> = {}): MachineSnap => ({
  at: new Date(2026, 0, 1, 14, 32, 7).getTime(), host: "central-sp-01", ip: "203.0.113.10", os: "Rocky Linux 8.10", uptime: 41 * 86400,
  cpu: { total: 39, cores: Array.from({ length: cores }, (_, i) => (i * 37) % 100), load: [2.14, 1.8, 1.32], history: [5, 20, 60, 90, 40, 39] },
  mem: { used: 3.1 * G, total: 6 * G }, swap: { used: 0, total: 2 * G }, disk: { used: 38 * G, total: 54 * G },
  net: { iface: "eth0", rx: 1.2 * 1048576, tx: 340 * 1024 }, procs: 212,
  top: [{ name: "asterisk", pct: 68 }, { name: "mysqld", pct: 12 }, { name: "httpd", pct: 4 }, { name: "sshd", pct: 3 }, { name: "cron", pct: 1 }],
  ...over,
});
