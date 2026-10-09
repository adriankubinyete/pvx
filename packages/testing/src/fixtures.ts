import { join } from "node:path";
import { linkModule, pvxHome } from "@pvx/core";

const FIXTURES = join(import.meta.dir, "../../core/test/fixtures/usermodules");

/**
 * A temp `usermodules/` inside the current PVX_HOME where each fixture is a `modules link` dev module (symlink recorded in
 * modules.json). This is how a subprocess test gets modules through the REAL trust gate: nothing in the env bypasses it.
 * Call it per test (PVX_HOME is fresh each time). Returns the env to hand to a child process.
 */
export function useFixtureModules(ids: string[], fixturesDir = FIXTURES): { PVX_HOME: string; PVX_USERMODULES: string } {
  const env = { PVX_HOME: pvxHome(), PVX_USERMODULES: join(pvxHome(), "usermodules") };
  process.env.PVX_USERMODULES = env.PVX_USERMODULES;
  for (const id of ids) {
    const r = linkModule(join(fixturesDir, id));
    if (!r.ok) throw new Error(`fixture "${id}": ${r.error}`);
  }
  return env;
}
