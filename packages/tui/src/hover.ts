import { useCallback, useState } from "react";

/** The key of whatever the mouse is over (one thing at a time): `enter(k)`/`leave(k)` are the `onMouseOver`/`onMouseOut` bodies. */
export function useOver<K extends string = string>() {
  const [over, setOver] = useState<K | undefined>(undefined);
  const enter = useCallback((k: K) => setOver(k), []);
  const leave = useCallback((k: K) => setOver((o) => (o === k ? undefined : o)), []);
  return { over, enter, leave };
}
