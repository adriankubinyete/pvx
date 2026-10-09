import type { Plan, PlanStep } from "./plan.ts";

export interface StepResult {
  step: PlanStep;
  status: "ok" | "error" | "skipped";
  code?: number;
}

/** Runs a frozen copy of the steps in order; stops at the first exit != 0 or when confirm says "stop". */
export async function applyPlan(
  plan: Plan,
  runStep: (step: PlanStep) => number | Promise<number>,
  confirm?: (step: PlanStep) => "yes" | "skip" | "stop" | Promise<"yes" | "skip" | "stop">,
): Promise<StepResult[]> {
  const steps = plan.steps.map((s) => ({ ...s })); // frozen: the prototype iterated the live list while it shrank
  const out: StepResult[] = [];
  for (const step of steps) {
    // No confirm (--yes): opt-in steps are never auto-applied.
    const answer = confirm ? await confirm(step) : step.optIn ? "skip" : "yes";
    if (answer === "stop") break;
    if (answer === "skip") { out.push({ step, status: "skipped" }); continue; }
    const code = await runStep(step);
    out.push({ step, status: code === 0 ? "ok" : "error", code });
    if (code !== 0) break;
  }
  return out;
}
