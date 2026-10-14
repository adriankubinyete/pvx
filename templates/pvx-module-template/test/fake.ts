// The `sdk` a factory receives, for tests that build the module without the host. `ui` is empty: nothing here renders a page.
import type { ProofKit, Sdk } from "@pvx/sdk";

/** `sdk.proof` as the host builds it (the tests do not load the host's own copy). */
export const fakeProof: ProofKit = {
  ok: (text, extra) => ({ level: "ok", text, ...extra }),
  warn: (text, extra) => ({ level: "warn", text, ...extra }),
  error: (text, extra) => ({ level: "error", text, ...extra }),
  async firstProblem(...steps) {
    for (const step of steps) {
      const proof = await step();
      if (proof && proof.level !== "ok") return proof;
    }
    return undefined;
  },
};

const quietLog = { debug() {}, info() {}, warn() {}, error() {} };

export const fakeSdk = (): Sdk => ({
  version: 1,
  ui: {} as Sdk["ui"],
  fs: {} as Sdk["fs"],
  log: quietLog,
  proof: fakeProof,
});

export const memStore = (init: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = { ...init };
  return { data, get: <T,>(key: string) => data[key] as T | undefined, set: (key: string, value: unknown) => void (data[key] = value), delete: (key: string) => void delete data[key] };
};
