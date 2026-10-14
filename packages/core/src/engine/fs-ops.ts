// The file operations behind `ctx.fs` that need more than a call: entry types, `du`, free space, `mkdir` with a mode and a guarded `remove`.
// Paths arrive already resolved and permission-checked by `createGranted`; nothing here knows about the manifest.
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, type Dirent, type Stats } from "node:fs";
import { lstat, readdir, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FsEntry, FsEntryType, FsSpace, FsStat } from "@pvx/sdk";

const STAT_BLOCK_BYTES = 512;
const PERMISSION_BITS = 0o7777;

/** A directory entry reports a symlink as itself, never as what it points to. */
function entryTypeOf(entry: Dirent): FsEntryType {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "dir";
  if (entry.isFile()) return "file";
  return "other";
}

/** Code-unit order, the same as `list`. */
function byName(left: FsEntry, right: FsEntry): number {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

export function listEntries(directory: string): FsEntry[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.map((entry) => ({ name: entry.name, type: entryTypeOf(entry) })).sort(byName);
}

export function statOf(path: string): FsStat | undefined {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return undefined;
  return { size: stats.size, isDir: stats.isDirectory(), mode: stats.mode & PERMISSION_BITS, mtimeMs: stats.mtimeMs };
}

/** What `du` counts: the blocks the entry holds (a sparse file is small), or its length where the platform has no blocks. */
function diskBytes(stats: Stats): number {
  if (process.platform === "win32") return stats.size;
  return stats.blocks * STAT_BLOCK_BYTES;
}

const inodeKey = (stats: Stats): string => `${stats.dev}:${stats.ino}`;

/** The stats of an entry, or undefined when it vanished or cannot be read (`du` skips those too). */
async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

async function childrenOf(directory: string): Promise<string[]> {
  try {
    const names = await readdir(directory);
    return names.map((name) => join(directory, name));
  } catch {
    return [];
  }
}

/** `du -s`: iterative, so a huge tree never nests calls, and it awaits between entries, so it never freezes the TUI. */
export async function diskUsage(root: string): Promise<number> {
  const seenInodes = new Set<string>();
  const pending = [root];
  let total = 0;
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    const stats = await lstatOrUndefined(path);
    if (!stats) continue;
    if (stats.nlink > 1 && !stats.isDirectory()) {
      if (seenInodes.has(inodeKey(stats))) continue;
      seenInodes.add(inodeKey(stats));
    }
    total += diskBytes(stats);
    if (stats.isDirectory()) pending.push(...(await childrenOf(path)));
  }
  return total;
}

/** The nearest parent that exists: a destination that is not created yet lives on the filesystem of its parent. */
function nearestExisting(path: string): string {
  let current = path;
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  return current;
}

export async function spaceOf(path: string): Promise<FsSpace> {
  const stats = await statfs(nearestExisting(path));
  return { totalBytes: stats.blocks * stats.bsize, availableBytes: stats.bavail * stats.bsize };
}

/** Creates the directory and its parents; `mode` is forced on the one it creates (the umask cannot narrow it), and a directory that exists is left alone. */
export function makeDirectory(path: string, mode: number | undefined): void {
  const created = mkdirSync(path, { recursive: true, ...(mode === undefined ? {} : { mode }) });
  if (created !== undefined && mode !== undefined) chmodSync(path, mode);
}

/** Whether `path` is the root of its filesystem (`/`, `C:\`): `dirname` of a root is itself. */
const isFilesystemRoot = (path: string): boolean => dirname(path) === path;

/** A file, or with `recursive` a directory and its contents. Never the filesystem root, whatever the manifest allows. */
export function removePath(path: string, recursive: boolean): void {
  if (isFilesystemRoot(path)) throw new Error(`recusei apagar ${path}: é a raiz do sistema de arquivos`);
  rmSync(path, { force: true, recursive });
}
