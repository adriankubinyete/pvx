import { applyPlan, type CoreLine } from "@pvx/core";
import type { Conformity, ConformityResult, ConformityStep } from "@pvx/sdk";
import type { SessionApi } from "../session/store.ts";

/** The last result of a core command: when it ran, its exit code and its lines. */
export interface CoreResult {
  at: number;
  exit: number;
  lines: CoreLine[];
}

/** What the last `conformidade` and `plano` runs returned. They fill together, so the two never disagree. */
export interface ConformitySnap {
  conformidade?: CoreResult;
  plano?: CoreResult;
  running: boolean;
}

export interface ConformityStore {
  getSnapshot(): ConformitySnap;
  subscribe(fn: () => void): () => void;
  refresh: Conformity["refresh"];
  apply: Conformity["apply"];
}

const LEVEL = { success: "ok", warning: "warn", error: "error" } as const;

/** The module-facing view of a snapshot (everything but `refresh` and `apply`). */
export function conformityView({ conformidade, plano, running }: ConformitySnap): Omit<Conformity, "refresh" | "apply"> {
  // An ignored item is a warning without a fix: its text already says "ignorado até HH:MM".
  const results = (conformidade?.lines ?? []).flatMap((l): ConformityResult[] =>
    l.ignored ? [{ level: "warn", text: l.text }] : l.kind in LEVEL ? [{ level: LEVEL[l.kind as keyof typeof LEVEL], text: l.text, fix: l.fix }] : []);
  const profile = conformidade?.lines.find((l) => l.kind === "info" && l.text.startsWith("perfil: "))?.text.slice("perfil: ".length);
  // Without a profile the only line is the command's own warning: it is the message, not a result.
  const message = conformidade && !profile ? conformidade.lines[0]?.text ?? "sem resultado" : undefined;
  const lines = plano?.lines ?? [];
  return {
    profile,
    message,
    results: message ? [] : results,
    plan: {
      steps: lines.flatMap((l) => (l.step ? [l.step as ConformityStep] : [])),
      manual: lines.filter((l) => l.text.startsWith("manual: ")).map((l) => l.text.slice("manual: ".length)),
    },
    checkedAt: conformidade?.at,
    running,
  };
}

const stores = new WeakMap<object, ConformityStore>();

/** The one cache of the TUI session (memory only): Início, module pages and `r` everywhere read and refresh the same data. */
export function conformityOf(session: Pick<SessionApi, "capture" | "run">): ConformityStore {
  let store = stores.get(session);
  if (store) return store;
  let snap: ConformitySnap = { running: false };
  const subs = new Set<() => void>();
  const set = (p: Partial<ConformitySnap>) => (snap = { ...snap, ...p }, subs.forEach((f) => f()));
  const run = async (line: string): Promise<CoreResult> => ({ at: Date.now(), ...(await session.capture(line)) });
  store = {
    getSnapshot: () => snap,
    subscribe: (fn) => (subs.add(fn), () => void subs.delete(fn)),
    refresh() {
      if (snap.running) return;
      set({ running: true });
      void Promise.all([run("conformidade"), run("plano")]).then(([conformidade, plano]) => set({ conformidade, plano, running: false }));
    },
    // Each step is a plain command through the session: scrollback, history and log. `applyPlan` freezes the list.
    apply: (confirm) => applyPlan({ steps: conformityView(snap).plan.steps, manual: [] }, async (s) => (await session.run(s.cmd)).exit, confirm),
  };
  stores.set(session, store);
  return store;
}
