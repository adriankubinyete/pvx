// What the module keeps in its store (`state.json`). One type per persisted shape, one key per type.
import type { Store } from "@pvx/sdk";

/** The store keys this module writes. Nothing else is persisted. */
export const STORE_KEY = {
  /** `string`: the last name greeted. */
  last: "nome",
  /** `string[]`: the latest names greeted, newest first. */
  history: "historico",
} as const;

export const DEFAULT_NAME = "mundo";
const HISTORY_LIMIT = 5;

export const lastName = (store: Pick<Store, "get">): string | undefined => store.get<string>(STORE_KEY.last);
export const greetedNames = (store: Pick<Store, "get">): string[] => store.get<string[]>(STORE_KEY.history) ?? [];

export function recordGreeting(store: Pick<Store, "get" | "set">, name: string): void {
  const rest = greetedNames(store).filter((greeted) => greeted !== name);
  store.set(STORE_KEY.last, name);
  store.set(STORE_KEY.history, [name, ...rest].slice(0, HISTORY_LIMIT));
}
