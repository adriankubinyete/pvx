// What the dnf and apt readers share: the state they mutate and the helpers that move a package between running, done and failed.
// They mutate in place on purpose: hundreds of lines a second must not copy 180 packages each time.
import type { PackagePhase, PackageProgress, PackageRef } from "@pvx/sdk";

export interface TrackerState {
  progress: PackageProgress;
  /** Name -> details, from a "Dependencies resolved" table (dnf). */
  known: Record<string, PackageRef>;
  /** Totals of the runs that ended well. */
  committed: number;
  /** Total of the run in progress, from its summary. */
  current: number;
  section: "none" | "table" | "failed";
  /** A long package name that wrapped onto its own line in the table (dnf). */
  wrapped?: string;
  phase?: PackagePhase;
}

/** Reads one line; true when the line was its own (no other reader is asked). */
export type LineReader = (state: TrackerState, line: string) => boolean;

export const emptyProgress = (): PackageProgress => ({ total: 0, done: [], running: [], failed: [] });

export const createTrackerState = (progress: PackageProgress = emptyProgress()): TrackerState => ({
  progress,
  known: {},
  committed: progress.done.length,
  current: 0,
  section: "none",
});

const ARCHES = new Set(["x86_64", "noarch", "i686", "i386", "aarch64", "ppc64le", "s390x", "src"]);
const EPOCH_OR_DIGIT = /^\d|^\d+:/;

/** `php-imap-7.4.33-1.el8.remi.x86_64(.rpm)` -> name, version-release, arch. A plain name comes back as itself. */
export function splitNevra(text: string): PackageRef {
  const bare = text.replace(/\.rpm$/, "");
  const dot = bare.lastIndexOf(".");
  const arch = dot > 0 && ARCHES.has(bare.slice(dot + 1)) ? bare.slice(dot + 1) : undefined;
  const withoutArch = arch ? bare.slice(0, dot) : bare;
  const parts = withoutArch.split("-");
  if (parts.length < 3 || !EPOCH_OR_DIGIT.test(parts[parts.length - 2] ?? "")) return { name: withoutArch, version: "", arch };
  const release = parts.pop()!;
  const version = parts.pop()!;
  return { name: parts.join("-"), version: `${version}-${release}`, arch };
}

export const nameOf = (text: string) => splitNevra(text).name;

export function dropRunning(state: TrackerState, name: string): void {
  state.progress.running = state.progress.running.filter((pkg) => pkg.name !== name);
}

export function setRunning(state: TrackerState, ref: PackageRef, phase: PackagePhase): void {
  dropRunning(state, ref.name);
  state.progress.running.push({ ...ref, phase });
}

export function markFailed(state: TrackerState, name: string): void {
  dropRunning(state, name);
  if (!state.progress.failed.includes(name)) state.progress.failed.push(name);
}

export function markDone(state: TrackerState, ref: PackageRef): void {
  dropRunning(state, ref.name);
  state.progress.failed = state.progress.failed.filter((name) => name !== ref.name);
  if (state.progress.done.some((pkg) => pkg.name === ref.name)) return;
  state.progress.done.push({ name: ref.name, version: ref.version, arch: ref.arch, repo: ref.repo, size: ref.size });
}

/** The total is what the runs announced, but never less than the packages already seen. */
export function syncTotal(state: TrackerState): void {
  const { done, failed, running } = state.progress;
  state.progress.total = Math.max(state.committed + state.current, done.length + failed.length + running.length);
}

/** What a page shows, as one comparable value. */
export const visibleState = (state: TrackerState): string => JSON.stringify([state.progress.done.length, state.progress.running, state.progress.failed, state.current]);
