/** Programs that need a TTY: with stdin closed and no terminal they hang or garble the screen. */
const INTERACTIVE = new Set(["vim", "vi", "nvim", "nano", "emacs", "less", "more", "most", "top", "htop", "btop", "man", "watch", "tmux", "screen", "mc", "ftp", "telnet"]);
/** REPLs: interactive only bare; with a script or `-c` they run fine without a TTY. */
const REPLS = new Set(["python", "python3", "node", "bun", "irb", "mysql", "psql", "sqlite3"]);

/** The interactive program a line would start (first word, also after `sudo`/`env`), if any. Heuristic: only the head of the line. */
export function interactiveProgram(cmd: string): string | undefined {
  const words = cmd.trim().split(/\s+/);
  while (words[0] === "sudo" || words[0] === "env" || words[0]?.includes("=")) words.shift();
  const name = words[0]?.split("/").pop() ?? "";
  if (REPLS.has(name)) return words.length === 1 ? name : undefined;
  return INTERACTIVE.has(name) ? name : undefined;
}

export interface ShellRun {
  /** Exit code: 124 on timeout, 130 when cancelled. */
  done: Promise<{ exit: number; reason?: "timeout" | "cancel" }>;
  /** SIGTERM to the whole group, SIGKILL if it ignores it. */
  cancel(): void;
}

const WINDOWS = process.platform === "win32";

/**
 * Windows has no `/bin/sh`: PowerShell is always there and keeps `ls`/`echo`/`sleep` working.
 * The preamble forces UTF-8 (the OEM code page drops accents) and hides progress records (they leak into a piped stderr).
 * Cost: an error raised by the line itself (`Write-Error`, `throw`) echoes the preamble.
 */
const PS_PREAMBLE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue'";
const shellArgv = (cmd: string) =>
  WINDOWS ? ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `${PS_PREAMBLE}\n${cmd}`] : ["/bin/sh", "-c", cmd];

/** `/bin/sh -c cmd` (PowerShell on Windows), no stdin, no TTY. `onData` gets raw text per chunk; the caller splits and sanitizes. */
export function spawnShell(cmd: string, timeoutMs: number, onData: (text: string, stderr: boolean) => void): ShellRun {
  const proc = Bun.spawn(shellArgv(cmd), { stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: !WINDOWS, windowsHide: true });
  let reason: "timeout" | "cancel" | undefined;
  const signal = (sig: NodeJS.Signals) => {
    // Windows has no process groups and proc.kill leaves the shell's children running: taskkill /T takes the tree.
    if (WINDOWS) return void Bun.spawn(["taskkill", "/T", "/F", "/PID", String(proc.pid)], { stdout: "ignore", stderr: "ignore", windowsHide: true });
    try {
      process.kill(-proc.pid, sig); // the group: `sh -c` may have forked the real program
    } catch {
      proc.kill(sig);
    }
  };
  const cancel = () => {
    if (proc.exitCode !== null || reason) return;
    reason = "cancel";
    signal("SIGTERM");
    setTimeout(() => signal("SIGKILL"), 2000).unref();
  };
  const timer = setTimeout(() => ((reason = "timeout"), signal("SIGKILL")), timeoutMs);
  const pump = async (s: ReadableStream<Uint8Array>, stderr: boolean) => {
    const dec = new TextDecoder();
    for await (const chunk of s) onData(dec.decode(chunk, { stream: true }), stderr);
  };
  const pipes = Promise.all([pump(proc.stdout, false), pump(proc.stderr, true)]);
  const done = (async () => {
    const exit = await proc.exited;
    clearTimeout(timer);
    // A background child that keeps the pipes open must not hold the block: wait only a moment for the tail.
    await Promise.race([pipes, Bun.sleep(300)]);
    return { exit: reason === "timeout" ? 124 : reason === "cancel" ? 130 : exit, reason };
  })();
  return { done, cancel };
}
