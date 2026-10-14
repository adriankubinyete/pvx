/** True when pvx runs as root. Windows has no uid and no sudo: the gate mirrors root owning PVX_HOME on Unix, which has no equivalent there. */
export function hostIsRoot(): boolean {
  return process.platform === "win32" || process.getuid?.() === 0;
}
