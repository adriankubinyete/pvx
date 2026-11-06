import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The path a technician typed or dropped on the terminal, as a path: no surrounding quotes, no backslash before a space (a drag from a file manager
 * pastes `/tmp/my\ clip.gif` or `'/tmp/my clip.gif'`), and `~` is the home directory.
 */
export function cleanGifPath(typed: string): string {
  let path = typed.trim();
  if (path.length > 1 && (path[0] === "'" || path[0] === '"') && path.endsWith(path[0]!)) path = path.slice(1, -1);
  path = path.replace(/\\(.)/g, "$1");
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
