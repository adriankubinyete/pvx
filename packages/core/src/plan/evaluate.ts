import type { CapabilityDef, ReadCtx } from "@pvx/sdk";
import type { Profile } from "./profiles.ts";

export interface EvalResult {
  id: string;
  title: string;
  goal: string;
  level: "ok" | "warn" | "error";
  text: string;
  fix?: string;
  affects?: string[];
  needs?: string[];
  /** Step must never be auto-applied with --yes. */
  optIn?: boolean;
}

type ProveCtx = ReadCtx;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tempo esgotado (${ms} ms)`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

export async function evaluate(
  profile: Profile,
  capabilities: Map<string, CapabilityDef>,
  ctxFor: (cap: CapabilityDef) => ProveCtx,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): Promise<EvalResult[]> {
  const run = async (id: string): Promise<EvalResult> => {
    const def = capabilities.get(id);
    if (!def) return { id, title: id, goal: "", level: "warn", text: "módulo ausente" };
    const base = { id, title: def.title, goal: def.goal, affects: def.affects, needs: def.needs, optIn: def.optIn };
    try {
      const proof = await withTimeout(Promise.resolve().then(() => def.prove(ctxFor(def))), timeoutMs);
      return { ...base, level: proof.level, text: proof.text, fix: proof.fix ?? def.fix };
    } catch (e) {
      return { ...base, level: "error", text: e instanceof Error ? e.message : String(e), fix: def.fix };
    }
  };
  // Profile order is kept by Promise.all; capabilities run concurrently so one slow one costs one timeout.
  return Promise.all(profile.requires.map(run));
}
