import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobOrigin, JobStatus, Jobs } from "@pvx/sdk";
import { auditJob } from "../journal/audit.ts";
import { createLogger } from "../logs/logger.ts";
import { logsDir, pvxHome } from "./paths.ts";

export const jobsDir = (id: string) => join(pvxHome(), "modules", id, "jobs");
const NAME = /^[a-z0-9-]+$/;
const GRACE_MS = 30_000; // a job with no pid yet (the child has not reported) counts as running this long

/** How the host reaches itself and the init system; tests replace it. */
export const jobsConfig = {
  /** The command that runs this pvx: the compiled binary, or `bun <entry>` in dev. */
  selfCmd: (): string[] => (/^(\/\$bunfs|[A-Za-z]:[\\/]~BUN)/.test(Bun.main) ? [process.execPath] : [process.execPath, Bun.main]),
  systemd: (): boolean => process.platform === "linux" && Boolean(Bun.which("systemd-run")),
  /** Who is acting: a process with a terminal is a technician, one without (cron, systemd) is a schedule. */
  origin: (): JobOrigin => (process.stdin.isTTY ? "manual" : "cron"),
};

interface State extends JobStatus {
  /** The command line (this module's, no module id). Never holds a secret. */
  line: string;
  /** The run was given secrets, which are gone: it cannot start again from the record alone. */
  withSecrets?: boolean;
}
const path = (id: string, name: string, ext: string) => join(jobsDir(id), `${name}.${ext}`);
export const secretsFile = (id: string, name: string) => path(id, name, "secrets");

export function readJobState(id: string, name: string): State | undefined {
  try {
    return JSON.parse(readFileSync(path(id, name, "json"), "utf8")) as State;
  } catch {
    return undefined;
  }
}
export function writeJobState(id: string, name: string, s: State): void {
  mkdirSync(jobsDir(id), { recursive: true, mode: 0o700 });
  const tmp = `${path(id, name, "json")}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, path(id, name, "json"));
}
/** One write with O_APPEND, so the job's lines and a reader never tear. */
export function appendJobLog(id: string, name: string, text: string): void {
  appendFileSync(path(id, name, "log"), text.split("\n").map((l) => `${l}\n`).join(""));
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The status of a job: a job that says it runs but whose process is gone counts as failed. */
export function statusOf(id: string, name: string): JobStatus {
  const s = readJobState(id, name);
  if (!s) return { state: "none" };
  const { line: _, ...st } = s;
  const live = st.pid ? alive(st.pid) : Date.now() - (st.startedAt ?? 0) < GRACE_MS;
  return st.state === "running" && !live ? { ...st, state: "failed" } : st; // died without reporting
}

/** `ctx.jobs` of one module. No permission check: jobs are a host feature. */
/** Start and stop go to core.log and to the module log (a failing logger never breaks the job). */
function lifecycle(id: string, level: "info" | "warn", text: string) {
  for (const n of ["core", id]) {
    try {
      createLogger(logsDir(), n)[level](n === "core" ? `job ${id}: ${text}` : text);
    } catch {}
  }
}

export function createJobs(id: string): Jobs {
  const status = async (name: string) => statusOf(id, name);
  return {
    status,
    async list() {
      if (!existsSync(jobsDir(id))) return [];
      return readdirSync(jobsDir(id)).filter((f) => f.endsWith(".json")).sort().map((f) => ({ name: f.slice(0, -5), ...statusOf(id, f.slice(0, -5)) }));
    },
    async log(name, { tail, since = 0 } = {}) {
      if (!NAME.test(name) || !existsSync(path(id, name, "log"))) return [];
      const lines = readFileSync(path(id, name, "log"), "utf8").split("\n");
      lines.pop(); // the text after the last newline is empty
      const rest = lines.slice(since);
      return tail === undefined ? rest : tail <= 0 ? [] : rest.slice(-tail);
    },
    async start(name, line, opts) {
      if (process.platform === "win32") throw new Error("jobs não funcionam no Windows");
      if (!NAME.test(name)) throw new Error(`nome de job inválido: "${name}" (use a-z, 0-9 e -)`);
      if (statusOf(id, name).state === "running") throw new Error(`o job "${name}" já está rodando; pare com \`pvx jobs stop ${id} ${name}\``);
      mkdirSync(jobsDir(id), { recursive: true, mode: 0o700 });
      writeFileSync(path(id, name, "log"), "");
      const secrets = Object.keys(opts?.secrets ?? {}).length ? opts!.secrets : undefined;
      rmSync(secretsFile(id, name), { force: true });
      if (secrets) {
        writeFileSync(secretsFile(id, name), JSON.stringify(secrets), { mode: 0o600 });
        chmodSync(secretsFile(id, name), 0o600);
      }
      writeJobState(id, name, { state: "running", startedAt: Date.now(), line, origin: jobsConfig.origin(), ...(secrets ? { withSecrets: true } : {}) });
      const self = [...jobsConfig.selfCmd(), "jobs", "run", id, name];
      const env = ["PVX_HOME", "PVX_USERMODULES"].filter((k) => process.env[k]).map((k) => `--setenv=${k}=${process.env[k]}`);
      const sys = jobsConfig.systemd();
      const argv = sys ? ["systemd-run", "--quiet", "--unit", `pvx-${id}-${name}`, "--collect", ...env, ...self] : self;
      try {
        // ponytail: `detached` gives the child its own session with no tty and every fd on /dev/null, which is what `setsid nohup` does.
        const p = Bun.spawn(argv, { env: { ...process.env }, detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
        p.unref();
        if (sys && (await p.exited) !== 0) throw new Error("systemd-run falhou");
      } catch (e) {
        rmSync(secretsFile(id, name), { force: true });
        writeJobState(id, name, { state: "failed", startedAt: Date.now(), endedAt: Date.now(), line });
        throw new Error(`não consegui iniciar o job "${name}": ${(e as Error).message}`);
      }
      lifecycle(id, "info", `job ${name} iniciado: ${line}`);
      auditJob(`start ${id}/${name}: ${id} ${line}`);
    },
    async stop(name) {
      const st = statusOf(id, name);
      if (st.state !== "running") throw new Error(`o job "${name}" não está rodando`);
      if (!st.pid) throw new Error(`o job "${name}" ainda está iniciando; tente de novo em instantes`);
      lifecycle(id, "warn", `job ${name}: parada pedida`);
      auditJob(`stop ${id}/${name}`);
      const asked = readJobState(id, name);
      if (asked) writeJobState(id, name, { ...asked, stoppedBy: jobsConfig.origin() }); // before the kill: the job's own last write keeps it
      const kill = (sig: NodeJS.Signals) => {
        try {
          process.kill(-st.pid!, sig);
        } catch {
          try {
            process.kill(st.pid!, sig);
          } catch {}
        }
      };
      kill("SIGTERM");
      for (let t = 0; t < 3000 && alive(st.pid); t += 50) await Bun.sleep(50);
      if (alive(st.pid)) kill("SIGKILL");
      const cur = readJobState(id, name);
      if (cur?.state === "running") writeJobState(id, name, { ...cur, state: "stopped", endedAt: Date.now() });
    },
  };
}

/** Every job of every module: `pvx jobs`. */
export async function listAllJobs(): Promise<(JobStatus & { module: string; name: string })[]> {
  const root = join(pvxHome(), "modules");
  if (!existsSync(root)) return [];
  const out = [];
  for (const m of readdirSync(root).sort()) for (const j of await createJobs(m).list()) out.push({ module: m, ...j });
  return out;
}
