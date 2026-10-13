import { existsSync, readFileSync } from "node:fs";
import type { Manifest } from "@pvx/sdk";

export interface HostPlatform {
  os: "linux" | "macos" | "windows" | "other";
  /** Lowercase `ID` then every `ID_LIKE` word of os-release (Linux only). */
  distros: string[];
  name: string;
}

/** Reads the host on every call; `osRelease` and `platform` are injectable for tests. */
export function hostPlatform(osRelease = "/etc/os-release", platform: NodeJS.Platform = process.platform): HostPlatform {
  if (platform === "win32") return { os: "windows", distros: [], name: "Windows" };
  if (platform === "darwin") return { os: "macos", distros: [], name: "macOS" };
  if (platform !== "linux") return { os: "other", distros: [], name: platform };
  const vars = new Map<string, string>();
  if (existsSync(osRelease)) {
    try {
      for (const line of readFileSync(osRelease, "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) vars.set(m[1]!, m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2"));
      }
    } catch {}
  }
  const distros = [vars.get("ID") ?? "", ...(vars.get("ID_LIKE") ?? "").split(/\s+/)].map((d) => d.toLowerCase()).filter(Boolean);
  return { os: "linux", distros, name: vars.get("PRETTY_NAME") || "Linux" };
}

export interface PlatformCheck {
  ok: boolean;
  /** What the module declares, for display. */
  wanted: string;
  host: string;
  text: string;
}

export function checkPlatform(m: Pick<Manifest, "os" | "distro">, host: HostPlatform): PlatformCheck {
  const { os, distro } = m;
  const required = Boolean(os || distro);
  const list = os ?? ["linux"];
  const wanted = required ? list.map((x) => (x === "linux" && distro ? `linux (${distro.join(", ")})` : x)).join(", ") : "qualquer sistema";
  const osOk = !os || os.includes(host.os as never);
  const distroOk = !distro || (host.os === "linux" && distro.some((d) => host.distros.includes(d.toLowerCase())));
  const ok = osOk && distroOk;
  const text = !ok ? `feito para ${wanted}; este sistema é ${host.name}` : required ? `${wanted} · este sistema: ${host.name}` : wanted;
  return { ok, wanted, host: host.name, text };
}
