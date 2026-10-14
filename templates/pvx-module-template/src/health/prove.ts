// The capabilities. A proof reads as a list of named steps (`proof.firstProblem`): a step answers with a problem or with nothing.
import type { CapabilityDef, Proof, ProofKit, Store } from "@pvx/sdk";
import { lastName } from "../state.ts";
import { FIX, TEXT } from "../texts.ts";

const nobodyGreeted = (proof: ProofKit, store: Pick<Store, "get">) => {
  if (!lastName(store)) return proof.warn(TEXT.nobodyGreeted, { fix: FIX.greet });
};

/** Exported so a test proves it with a plain store, without building a whole `ReadCtx`. */
export async function proveGreeting(proof: ProofKit, store: Pick<Store, "get">): Promise<Proof> {
  return (await proof.firstProblem(() => nobodyGreeted(proof, store))) ?? proof.ok(TEXT.greetingDone);
}

export function capabilities(proof: ProofKit): CapabilityDef[] {
  return [
    {
      id: "exemplo.saudacao",
      title: "Alguém foi saudado",
      goal: "O módulo já guardou um nome",
      fix: FIX.greet,
      prove: ({ store }) => proveGreeting(proof, store),
    },
  ];
}
