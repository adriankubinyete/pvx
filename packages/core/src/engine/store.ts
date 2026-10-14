import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "@pvx/sdk";
import { moduleStateDir } from "./paths.ts";

const STATE_DIR_MODE = 0o700;
const STATE_FILE_MODE = 0o600;

/** Temp file born 0600, then rename: the file is never readable by others, and a looser one is replaced. */
function writePrivateFile(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, text, { mode: STATE_FILE_MODE });
  renameSync(tmp, file);
}

/** state.json per module. Created lazily: nothing is written until set. Mode 0600, atomic write (temp + rename). */
export function createStore(id: string): Store {
  const file = () => join(moduleStateDir(id), "state.json");
  const read = (): Record<string, unknown> => (existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {});
  const write = (data: Record<string, unknown>) => {
    mkdirSync(moduleStateDir(id), { recursive: true, mode: STATE_DIR_MODE });
    writePrivateFile(file(), JSON.stringify(data, null, 2));
  };
  return {
    get: <T>(key: string) => read()[key] as T | undefined,
    set(key, value) {
      write({ ...read(), [key]: value });
    },
    update<T>(key: string, change: (current: T | undefined) => T): T {
      const data = read();
      const next = change(data[key] as T | undefined);
      write({ ...data, [key]: next });
      return next;
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
