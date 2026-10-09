import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "@pvx/sdk";
import { moduleStateDir } from "./paths.ts";

/** state.json per module. Created lazily: nothing is written until set. Atomic write (temp + rename). */
export function createStore(id: string): Store {
  const file = () => join(moduleStateDir(id), "state.json");
  const read = (): Record<string, unknown> => (existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {});
  const write = (data: Record<string, unknown>) => {
    mkdirSync(moduleStateDir(id), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file());
  };
  return {
    get: <T>(key: string) => read()[key] as T | undefined,
    set(key, value) {
      write({ ...read(), [key]: value });
    },
    delete(key) {
      const d = read();
      if (key in d) {
        delete d[key];
        write(d);
      }
    },
  };
}
