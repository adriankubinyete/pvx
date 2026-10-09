// Child process of the concurrency test: appends N notes through the real `nota add` command, as root.
import { createLogger, createRegistry, loadModules, logsDir, runCli } from "../../packages/core/src/index.ts";
import { theme } from "../../packages/tui/src/index.ts";
import { builtin } from "../../packages/builtin/index.ts";

const [tag, n] = [process.argv[2]!, Number(process.argv[3])];
const registry = createRegistry();
await loadModules(registry, { hostVersion: "0.1.0", makeLogger: (m) => createLogger(logsDir(), m), builtin });
let bad = 0;
for (let i = 0; i < n; i++) {
  const exit = await runCli({
    argv: ["nota", "add", "--tag", tag, `nota ${tag} ${i} ${"x".repeat(200)}`],
    env: process.env, isTTY: false, isRoot: true, registry, makeLogger: (m) => createLogger(logsDir(), m),
    profilesDir: "", version: "0.1.0", theme, out: () => {},
  });
  if (exit !== 0) bad++;
}
process.exit(bad);
