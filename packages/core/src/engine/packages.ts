import type { PackageManager, PackageTracker, PackagesKit } from "@pvx/sdk";
import { APT_READERS } from "./packages-apt.ts";
import { DNF_READERS } from "./packages-dnf.ts";
import { createTrackerState, markDone, markFailed, syncTotal, visibleState, type LineReader } from "./packages-state.ts";

const READERS: Record<PackageManager, LineReader[]> = { dnf: DNF_READERS, apt: APT_READERS };

/** The tracker of one package manager's output. */
function createTracker(manager: PackageManager, saved?: Parameters<PackagesKit["tracker"]>[1]): PackageTracker {
  const state = createTrackerState(saved);
  const readers = READERS[manager];
  return {
    progress: state.progress,
    get phase() {
      return state.phase;
    },
    feed(line) {
      const text = line.trimEnd();
      const before = visibleState(state);
      readers.some((reader) => reader(state, text));
      syncTotal(state);
      return before !== visibleState(state);
    },
    endRun(ok) {
      for (const pkg of [...state.progress.running]) {
        if (ok) markDone(state, pkg);
        else markFailed(state, pkg.name);
      }
      if (ok) state.committed += state.current;
      Object.assign(state, { current: 0, known: {}, section: "none", wrapped: undefined, phase: undefined });
      syncTotal(state);
    },
    fail(name) {
      markFailed(state, name);
      syncTotal(state);
    },
  };
}

/** `sdk.packages`: parsers of `dnf` and `apt` output. */
export const packagesKit: PackagesKit = { tracker: createTracker };
