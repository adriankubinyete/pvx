import { useEffect, useRef, useState } from "react";

/** The progress label of the primary button while its command runs. */
export const DEFAULT_BUSY_LABEL = "executando…";
/** What the nudge says when the user leaves a busy form. */
export const BACKGROUND_NUDGE = "continua rodando em segundo plano";

export interface Busy {
  busy: boolean;
  /** Starts the busy state when `result` is a promise, and ends it when it settles (fulfilled or not). Anything else is ignored. */
  track(result: unknown): void;
}

/** The busy state of a form: from the submit until the command it started finishes. A page that unmounted meanwhile hears nothing. */
export function useBusy(): Busy {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const track = (result: unknown) => {
    if (!(result instanceof Promise)) return;
    setBusy(true);
    const finish = () => void (mounted.current && setBusy(false));
    result.then(finish, finish);
  };
  return { busy, track };
}
