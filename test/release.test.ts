import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
/** A test that compiles the real app: under load (the full suite) a `bun build --compile` takes far more than the 5 s default. */
const COMPILE_TIMEOUT_MS = 180_000;

/** Compiles the real app for the host and returns the unpacked binary path. */
function build(release: boolean) {
  const dist = mkdtempSync(join(tmpdir(), "pvx-dist-"));
  const env = { ...process.env, PVX_DIST: dist, PVX_RELEASE_BUILD: release ? "1" : "" };
  const b = Bun.spawnSync(["sh", join(root, "scripts/build.sh"), "host"], { env });
  expect(b.exitCode).toBe(0);
  Bun.spawnSync(["tar", "-xzf", join(dist, "pvx-host.tar.gz"), "-C", dist]);
  return join(dist, "pvx");
}

// Regression (pvx Python): releases went out as "X.Y.Z (nightly, <commit>)" because the build mode defaulted to dev.
test("a release-mode artifact has no dev mark and prints the plain version; a dev build has both", () => {
  const rel = build(true);
  expect(readFileSync(rel).includes("nightly, ")).toBe(false);
  // The guard release.sh runs on every artifact: a real release binary carries none of the dev marks.
  expect(Bun.spawnSync(["sh", join(root, "scripts/check-artifact.sh"), join(rel, "..", "pvx-host.tar.gz")]).exitCode).toBe(0);
  for (const mark of ["dev-build:", "pvx-embedded-module:"]) expect(readFileSync(rel).includes(mark)).toBe(false);
  expect(Bun.spawnSync([rel, "--version"]).stdout.toString().trim()).toBe(`pvx ${version}`);
  expect(Bun.spawnSync([rel, "version"]).stdout.toString().trim()).toBe(`pvx ${version}`);

  const dev = build(false);
  expect(Bun.spawnSync([dev, "--version"]).stdout.toString()).toMatch(new RegExp(`^pvx ${version.replace(/\./g, "\\.")} \\(nightly, \\w+\\)`));
}, COMPILE_TIMEOUT_MS);

test("release.sh builds in release mode and never publishes by itself", () => {
  const sh = readFileSync(join(root, "scripts/release.sh"), "utf8");
  expect(sh).toContain("PVX_RELEASE_BUILD=1");
  const ghLines = sh.split("\n").filter((l) => l.includes("gh release"));
  expect(ghLines.length).toBeGreaterThan(0);
  expect(ghLines.every((l) => l.trim().startsWith("echo"))).toBe(true);
});
