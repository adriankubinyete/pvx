/** True when this process is a compiled binary (`bun build --compile`), not `bun` running the source. */
const isCompiled = (): boolean => /^(\/\$bunfs|[A-Za-z]:[\\/]~BUN)/.test(Bun.main);

/**
 * True when pvx runs as root. Windows has no uid and no sudo: the gate mirrors root owning PVX_HOME on Unix, which has no equivalent there.
 * `bun dev` sets `PVX_DEV=1` to write in its own `.dev/pvx` without sudo. That works only when running the source: a compiled binary ignores it, so no environment variable opens the gate on a real central.
 */
export function hostIsRoot(): boolean {
  if (process.env.PVX_DEV === "1" && !isCompiled()) return true;
  return process.platform === "win32" || process.getuid?.() === 0;
}
