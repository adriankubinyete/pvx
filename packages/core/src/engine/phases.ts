import type { Out, PhaseDef, PhaseFailure, PhaseOutcome, PhaseRecord, Phases, PhasesKit, PhasesResult, PhasesState, Store } from "@pvx/sdk";
import { isStepError, messageOf } from "./errors.ts";

type Say = Pick<Out, "info" | "success" | "error">;

const silent: Say = { info() {}, success() {}, error() {} };
const DEFAULT_WEIGHT = 1;
/** `phase.progress` writes the store at most this often... */
const PROGRESS_WRITE_MS = 250;
/** ...unless the fraction moved by at least this much. */
const PROGRESS_WRITE_STEP = 0.01;

/** The store key of the phases named `name`. */
export const phasesKey = (name: string) => `phases:${name}`;

const isFinished = (record: PhaseRecord) => record.state === "done" || record.state === "skipped";

/** True when every phase is done or skipped, except the `trailing` ones (ids): a final countdown does not hold the run back. */
export function allPhasesFinished(state: PhasesState, trailing: string[] = []): boolean {
  return state.phases.filter((record) => !trailing.includes(record.id)).every(isFinished);
}

/** What a phase has earned so far: all of its weight when finished, else its weight times its partial progress. */
function earnedBy(record: PhaseRecord): number {
  if (isFinished(record)) return record.weight;
  return record.weight * (record.progress ?? 0);
}

/** 0..1 across the whole run: the weight of each finished phase plus the running one's weight times its `progress`. */
export function phasesProgress(state: PhasesState): number {
  const total = state.phases.reduce((sum, record) => sum + record.weight, 0);
  const earned = state.phases.reduce((sum, record) => sum + earnedBy(record), 0);
  return total > 0 ? earned / total : 0;
}

/** `sdk.phases`. */
export const phasesKit: PhasesKit = { progress: phasesProgress, finished: allPhasesFinished };

const clampFraction = (fraction: number): number => Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));

/** Decides when a `progress` call is worth a store write: the first one, a 1% move, or 250 ms since the last write. */
function progressThrottle(now: () => number): (fraction: number) => boolean {
  let writtenAt = Number.NEGATIVE_INFINITY;
  let writtenFraction = Number.NEGATIVE_INFINITY;
  return (fraction) => {
    const moved = Math.abs(fraction - writtenFraction) >= PROGRESS_WRITE_STEP;
    const waited = now() - writtenAt >= PROGRESS_WRITE_MS;
    if (!moved && !waited) return false;
    writtenAt = now();
    writtenFraction = fraction;
    return true;
  };
}

function newState(defs: PhaseDef[], now: number): PhasesState {
  const phases = defs.map((def): PhaseRecord => ({ id: def.id, label: def.label, weight: def.weight ?? DEFAULT_WEIGHT, state: "pending" }));
  return { phases, startedAt: now, runStartedAt: now };
}

/** A phase that was running when the process died is redone: it goes back to pending. */
function resumeState(saved: PhasesState, now: number): PhasesState {
  for (const record of saved.phases.filter((phase) => !isFinished(phase))) {
    Object.assign(record, { state: "pending", startedAt: undefined, endedAt: undefined, detail: undefined, progress: undefined });
  }
  return { ...saved, runStartedAt: now, failure: undefined };
}

const sameIds = (saved: PhasesState, defs: PhaseDef[]) => saved.phases.map((phase) => phase.id).join() === defs.map((def) => def.id).join();

function failureOf(phase: PhaseDef, error: unknown): PhaseFailure {
  const failure: PhaseFailure = { phase: phase.id, message: messageOf(error) };
  if (isStepError(error)) Object.assign(failure, { command: error.command, code: error.code, output: error.output });
  return failure;
}

/** `ctx.phases`: the runner over a store. `say` is where each phase reports (`ctx.out`); without it nothing is printed. */
export function createPhases(store: Store, say: Say = silent, now: () => number = Date.now): Phases {
  const read = (name: string) => store.get<PhasesState>(phasesKey(name));

  async function runOne(name: string, state: PhasesState, def: PhaseDef, record: PhaseRecord): Promise<PhasesResult | undefined> {
    const save = () => store.set(phasesKey(name), state);
    const report = (detail: string) => {
      record.detail = detail;
      save();
    };
    const shouldWrite = progressThrottle(now);
    const progress = (fraction: number) => {
      const clamped = clampFraction(fraction);
      if (!shouldWrite(clamped)) return;
      record.progress = clamped;
      save();
    };
    Object.assign(record, { state: "running", startedAt: now(), endedAt: undefined, detail: undefined, progress: undefined });
    save();
    say.info(`fase ${def.label}: iniciando`);
    try {
      const outcome: PhaseOutcome = (await def.run({ report, progress })) ?? {};
      finishRecord(record, outcome, now());
      say.success(outcome.skipped ? `fase ${def.label}: pulada (${outcome.skipped})` : `fase ${def.label}: concluída`);
      save();
      return undefined;
    } catch (error) {
      Object.assign(record, { state: "failed", endedAt: now() });
      state.failure = failureOf(def, error);
      save();
      say.error(`fase ${def.label}: falhou: ${messageOf(error)}`);
      return { ok: false, failedPhase: def.id, error };
    }
  }

  async function run(name: string, defs: PhaseDef[], opts?: { fresh?: boolean }): Promise<PhasesResult> {
    const saved = read(name);
    const resuming = saved && !opts?.fresh && sameIds(saved, defs);
    const state = resuming ? resumeState(saved, now()) : newState(defs, now());
    store.set(phasesKey(name), state);
    for (const def of defs) {
      const record = state.phases.find((phase) => phase.id === def.id)!;
      if (isFinished(record)) {
        say.info(`fase ${def.label}: já concluída, pulando`);
        continue;
      }
      const failed = await runOne(name, state, def, record);
      if (failed) return failed;
    }
    return { ok: true };
  }

  return { run, state: read, reset: (name) => store.delete(phasesKey(name)) };
}

function finishRecord(record: PhaseRecord, outcome: PhaseOutcome, endedAt: number): void {
  if (outcome.skipped) {
    Object.assign(record, { state: "skipped", detail: outcome.skipped, progress: undefined });
    return;
  }
  Object.assign(record, { state: "done", endedAt, detail: outcome.detail ?? record.detail, progress: undefined });
}
