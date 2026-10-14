// What a page shows of a job and of a phased run. Pure: the hooks feed it, the tests read it.
import { allPhasesFinished, phasesProgress } from "@pvx/core";
import type { JobStatus, JobView, PhaseRecord, PhasesState, RunView, StepItem } from "@pvx/sdk";

export const DEFAULT_STALE_MS = 30_000;

const JOB_VIEW: Record<JobStatus["state"], JobView> = { none: "idle", running: "running", done: "done", failed: "failed", stopped: "stopped" };

/** A job that runs but has written nothing for a while is `stale`: it may be hung or dead. */
export function jobViewOf(status: JobStatus, quietMs: number, staleMs: number = DEFAULT_STALE_MS): JobView {
  const view = JOB_VIEW[status.state];
  if (view === "running" && quietMs >= staleMs) return "stale";
  return view;
}

/** A state written by an older job than the one the host knows is a leftover: the page must not show it as this run. */
export function isCurrentRun(state: PhasesState | undefined, status: JobStatus): state is PhasesState {
  return state !== undefined && (status.startedAt === undefined || state.runStartedAt >= status.startedAt);
}

const JOB_VIEW_TO_RUN: Partial<Record<JobView, RunView>> = { running: "running", stale: "stale" };

/**
 * A finished run stays `done` even after the job (or the central) went away; a job that ended before the last phase is `failed`.
 * A `trailing` phase (a final countdown) does not hold `done` back. While `loading` nothing is known yet, so the view is `idle`.
 */
export function runViewOf(jobView: JobView, state: PhasesState | undefined, current: boolean, trailing: string[] = [], loading = false): RunView {
  if (loading) return "idle";
  const alive = JOB_VIEW_TO_RUN[jobView];
  if (!state || !current) return alive ?? "idle";
  if (state.failure) return "failed";
  if (allPhasesFinished(state, trailing)) return "done";
  return alive ?? "failed";
}

function elapsedOf(record: PhaseRecord, now: number): number | undefined {
  if (record.startedAt === undefined) return undefined;
  return (record.endedAt ?? now) - record.startedAt;
}

/** The rows of `Steps`, one per phase. */
export function stepsOf(state: PhasesState | undefined, now: number = Date.now()): StepItem[] {
  if (!state) return [];
  return state.phases.map((record) => ({ id: record.id, label: record.label, state: record.state, elapsedMs: elapsedOf(record, now), detail: record.detail }));
}

export const progressOf = (state: PhasesState | undefined): number => (state ? phasesProgress(state) : 0);
