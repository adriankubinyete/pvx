import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;

/** Compiles the real app for the host and returns the unpacked binary path. */
function build(release: boolean, profilesSrc?: string) {
  const dist = mkdtempSync(join(tmpdir(), "pvx-dist-"));
  const env = { ...process.env, PVX_DIST: dist, PVX_RELEASE_BUILD: release ? "1" : "", ...(profilesSrc ? { PVX_PROFILES_SRC: profilesSrc } : {}) };
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
}, 120_000);

test("the compiled binary carries only the selected profiles (no profiles dir next to it)", () => {
  const src = mkdtempSync(join(tmpdir(), "pvx-profiles-"));
  copyFileSync(join(root, "packages/core/test/fixtures/profiles/10-main.json"), join(src, "10-main.json"));
  const bin = build(true, src);
  const r = Bun.spawnSync([bin, "conformidade", "--json"], { env: { ...process.env, PVX_PROFILE: "main" } });
  // An unknown PVX_PROFILE would be a usage error: "main" must have come from the embedded set.
  expect(r.stdout.toString()).not.toContain("desconhecido");
  expect(readdirSync(join(bin, "..")).includes("profiles")).toBe(false);
}, 120_000);

// Regression: an untracked local profiles/10-main.json shipped inside release v0.1.0.
test("an untracked file in profiles/ is not embedded", () => {
  const stray = join(root, "profiles/99-untracked-test.json");
  const fixture = readFileSync(join(root, "packages/core/test/fixtures/profiles/10-main.json"), "utf8");
  writeFileSync(stray, fixture.replace('"main"', '"strayprofile"'));
  try {
    const bin = build(true);
    expect(readFileSync(bin).includes("strayprofile")).toBe(false);
  } finally {
    rmSync(stray, { force: true });
  }
}, 120_000);

test("release.sh builds in release mode and never publishes by itself", () => {
  const sh = readFileSync(join(root, "scripts/release.sh"), "utf8");
  expect(sh).toContain("PVX_RELEASE_BUILD=1");
  const ghLines = sh.split("\n").filter((l) => l.includes("gh release"));
  expect(ghLines.length).toBeGreaterThan(0);
  expect(ghLines.every((l) => l.trim().startsWith("echo"))).toBe(true);
});
