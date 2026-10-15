// The tasks of the central: every job of every module with the phases it reached. What the Tarefas tab reads.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { JobStatus, PhasesState } from "@pvx/sdk";
import { jobsDir, readJobState, statusOf } from "./jobs.ts";
import { pvxHome } from "./paths.ts";
import { allPhasesFinished, phasesKey } from "./phases.ts";
import { createStore } from "./store.ts";

export interface Task {
  module: string;
  name: string;
  /** The command line of the run, as the job file keeps it. */
  line: string;
  status: JobStatus;
  /** The phases of the module's run with this name (`ctx.phases.run(name, ...)`), when it keeps any. */
  phases?: PhasesState;
  /** Starting it again continues from the phase it stopped in. */
  resumable: boolean;
}

/** How long a finished task stays in the list. */
export const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;

const JOB_FILE = /\.json$/;

/** A phases state written by an older run than the job's own is a leftover: it does not describe this run. */
const isCurrentRun = (phases: PhasesState, status: JobStatus): boolean => status.startedAt === undefined || phases.runStartedAt >= status.startedAt;

/**
 * A task continues from its phases when it ended before the last one (failed or stopped) and was not given secrets
 * (they were deleted at the start, so a start from the record would run without them).
 */
export function isResumable(status: JobStatus, phases: PhasesState | undefined, withSecrets: boolean): boolean {
  if (withSecrets || !phases || !isCurrentRun(phases, status)) return false;
  if (status.state !== "failed" && status.state !== "stopped") return false;
  return !allPhasesFinished(phases);
}

function taskOf(module: string, name: string): Task | undefined {
  const record = readJobState(module, name);
  if (!record) return undefined;
  const status = statusOf(module, name);
  const phases = createStore(module).get<PhasesState>(phasesKey(name));
  return { module, name, line: record.line, status, phases, resumable: isResumable(status, phases, Boolean(record.withSecrets)) };
}

/** Every job of every module, newest start first. Reads the disk: cheap enough to poll. */
export function listTasks(): Task[] {
  const root = join(pvxHome(), "modules");
  if (!existsSync(root)) return [];
  const tasks: Task[] = [];
  for (const module of readdirSync(root).sort()) {
    if (!existsSync(jobsDir(module))) continue;
    for (const file of readdirSync(jobsDir(module)).filter((entry) => JOB_FILE.test(entry))) {
      const task = taskOf(module, file.replace(JOB_FILE, ""));
      if (task) tasks.push(task);
    }
  }
  return tasks.sort((a, b) => (b.status.startedAt ?? 0) - (a.status.startedAt ?? 0));
}
