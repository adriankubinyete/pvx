// The fake `ctx.fs` of a test machine: a map of path to text, with directories read off the paths (a file under `/a/b` makes `/a/b` a
// directory) and the ones `mkdir` made. `list`, `entries`, `stat`, `du` and `free` answer over those files, as the real ones do over a disk.
import type { FsEntry, FsSpace, FsStat, ModuleFs, WriteOpts } from "@pvx/sdk";

/** Roomy by default (1 TiB of 2 TiB), so a test that does not care about space never trips on it. */
const ROOMY_SPACE: FsSpace = { totalBytes: 2 * 1024 ** 4, availableBytes: 1024 ** 4 };
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIR_MODE = 0o755;
const ROOT = "/";

export interface FakeFsState {
  files: Map<string, string>;
  modes: Map<string, number>;
  /** Directories made by `mkdir` (empty ones too). A directory with a file under it needs no entry here. */
  dirs: Set<string>;
  /** Modification times (ms) by path; a path without one reports 0. */
  mtimes: Map<string, number>;
  /** What `free` answers for any path: a test changes `availableBytes` to simulate a full disk. */
  space: FsSpace;
}
export type FakeFs = ModuleFs & FakeFsState;

const normalized = (path: string): string => path.replace(/\/+$/, "") || ROOT;
const prefixOf = (directory: string): string => (directory === ROOT ? ROOT : `${directory}/`);
const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

function noEntry(path: string): Error {
  return new Error(`ENOENT: sem arquivo ou diretório ${path}`);
}

function paths(state: FakeFsState): string[] {
  return [...state.files.keys(), ...state.dirs];
}

function isDirectory(state: FakeFsState, path: string): boolean {
  if (path === ROOT || state.dirs.has(path)) return true;
  return paths(state).some((known) => known.startsWith(prefixOf(path)));
}

/** The names right under `directory`, each with its type: a name with more path after it is a directory. */
function childrenOf(state: FakeFsState, directory: string): FsEntry[] {
  const prefix = prefixOf(directory);
  const found = new Map<string, FsEntry["type"]>();
  for (const known of paths(state)) {
    if (!known.startsWith(prefix)) continue;
    const [name, ...deeper] = known.slice(prefix.length).split("/");
    const isLeafFile = deeper.length === 0 && state.files.has(known);
    found.set(name!, isLeafFile ? "file" : "dir");
  }
  return [...found].map(([name, type]) => ({ name, type })).sort((left, right) => (left.name < right.name ? -1 : 1));
}

function entriesOf(state: FakeFsState, path: string): FsEntry[] {
  if (!isDirectory(state, path)) throw noEntry(path);
  return childrenOf(state, path);
}

function statOf(state: FakeFsState, path: string): FsStat | undefined {
  const mtimeMs = state.mtimes.get(path) ?? 0;
  const text = state.files.get(path);
  if (text !== undefined) return { size: byteLength(text), isDir: false, mode: state.modes.get(path) ?? DEFAULT_FILE_MODE, mtimeMs };
  if (isDirectory(state, path)) return { size: 0, isDir: true, mode: state.modes.get(path) ?? DEFAULT_DIR_MODE, mtimeMs };
  return undefined;
}

/** The bytes of the file, or of every file under the directory; 0 for a path that is not there (like the real `du`). */
function usageOf(state: FakeFsState, path: string): number {
  const own = state.files.get(path);
  if (own !== undefined) return byteLength(own);
  const prefix = prefixOf(path);
  let total = 0;
  for (const [file, text] of state.files) {
    if (file.startsWith(prefix)) total += byteLength(text);
  }
  return total;
}

function removeEntry(state: FakeFsState, path: string, recursive: boolean): void {
  if (path === ROOT) throw new Error("recusei apagar /: é a raiz do sistema de arquivos");
  if (state.files.delete(path)) return;
  if (!isDirectory(state, path)) return;
  if (!recursive) throw new Error(`EISDIR: ${path} é um diretório; use recursive`);
  const prefix = prefixOf(path);
  for (const known of paths(state)) {
    if (known === path || known.startsWith(prefix)) {
      state.files.delete(known);
      state.dirs.delete(known);
    }
  }
}

export function fakeFs(initial: Record<string, string> = {}, space: Partial<FsSpace> = {}): FakeFs {
  const state: FakeFsState = { files: new Map(Object.entries(initial)), modes: new Map(), dirs: new Set(), mtimes: new Map(), space: { ...ROOMY_SPACE, ...space } };
  // The methods read `state` on every call, so a test that replaces `fs.space` (or any map) is heard.
  return Object.assign(state, {
    read: async (path: string) => {
      const text = state.files.get(path);
      if (text === undefined) throw new Error(`sem arquivo ${path}`);
      return text;
    },
    async write(path: string, data: string, opts?: WriteOpts) {
      state.files.set(path, data);
      if (opts?.mode !== undefined) state.modes.set(path, opts.mode);
    },
    exists: async (path: string) => state.files.has(path) || isDirectory(state, normalized(path)),
    list: async (path: string) => entriesOf(state, normalized(path)).map((entry) => entry.name),
    entries: async (path: string) => entriesOf(state, normalized(path)),
    stat: async (path: string) => statOf(state, normalized(path)),
    du: async (path: string) => usageOf(state, normalized(path)),
    free: async () => ({ ...state.space }),
    async mkdir(path: string, opts?: { mode?: number }) {
      const directory = normalized(path);
      if (state.dirs.has(directory) || state.files.has(directory)) return;
      state.dirs.add(directory);
      if (opts?.mode !== undefined) state.modes.set(directory, opts.mode);
    },
    remove: async (path: string, opts?: { recursive?: boolean }) => removeEntry(state, normalized(path), opts?.recursive ?? false),
    append: async (path: string, text: string) => void state.files.set(path, (state.files.get(path) ?? "") + text),
  });
}
