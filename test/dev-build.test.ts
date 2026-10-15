import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactStem, buildSummary, copyHint, embeddedEntrySource, gitState, inspectAll, inspectModule, type BuildFacts } from "../scripts/dev-build.ts";

const root = join(import.meta.dir, "..");
const fixtureSource = join(import.meta.dir, "fixtures/embed-module");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;

let work = "";
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "pvx-devbuild-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString().trim();
};

/** A copy of the fixture module as its own committed git repository. */
function moduleRepo(name = "embed-demo"): string {
  const dir = join(work, name);
  cpSync(fixtureSource, dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

const context = { hostVersion: version, taken: new Set<string>() };

// ---------------------------------------------------------------- names and texts

const facts = (overrides: Partial<BuildFacts> = {}): BuildFacts => ({
  version: "0.1.2",
  target: "linux-amd64",
  now: new Date(2026, 9, 15, 14, 32),
  host: { commit: "4d8baf8", dirty: false },
  modules: [],
  ...overrides,
});

test("the artifact name carries version, build time, host commit, dirty mark and target", () => {
  expect(artifactStem(facts())).toBe("pvx-0.1.2-dev.20261015.1432-4d8baf8-linux-amd64");
  expect(artifactStem(facts({ host: { commit: "4d8baf8", dirty: true } }))).toBe("pvx-0.1.2-dev.20261015.1432-4d8baf8-dirty-linux-amd64");
  expect(artifactStem(facts({ target: "darwin-arm64", now: new Date(2027, 0, 3, 9, 5) }))).toBe("pvx-0.1.2-dev.20270103.0905-4d8baf8-darwin-arm64");
});

test("BUILD.txt lists version, time, host commit, target and every embedded module", () => {
  const modules = [
    { id: "firewall", version: "0.1.0", source: "/work/pvx-firewall", commit: "0c94e67", dirty: true },
    { id: "autobackup", version: "0.2.0", source: "/work/pvx-dummy", commit: "2c9a19a", dirty: false },
  ];
  expect(buildSummary(facts({ modules, host: { commit: "4d8baf8", dirty: true } }))).toBe(
    [
      "pvx 0.1.2 (dev, +firewall +autobackup)",
      "versão:   0.1.2",
      "build:    2026-10-15 14:32",
      "host:     4d8baf8 (alterações não commitadas)",
      "alvo:     linux-amd64",
      "módulos embutidos (* = alterações não commitadas):",
      "  firewall 0.1.0  commit 0c94e67*  /work/pvx-firewall",
      "  autobackup 0.2.0  commit 2c9a19a  /work/pvx-dummy",
      "",
    ].join("\n"),
  );
  expect(buildSummary(facts())).toContain("módulos embutidos: nenhum");
});

test("the copy hint is the scp and ssh line of the spec", () => {
  expect(copyHint(facts(), "dist/pvx-0.1.2-dev.20261015.1432-4d8baf8-linux-amd64.tar.gz")).toBe(
    "scp dist/pvx-0.1.2-dev.20261015.1432-4d8baf8-linux-amd64.tar.gz central:/tmp/ && ssh central 'cd /tmp && tar xzf pvx-0.1.2-dev.20261015.1432-4d8baf8-linux-amd64.tar.gz && sudo ./pvx'",
  );
});

// ---------------------------------------------------------------- validating a checkout

test("a checkout is recorded with id, version, source, short commit and dirty state", async () => {
  const dir = moduleRepo();
  const clean = await inspectModule(dir, context);
  expect(clean.info).toEqual({ id: "embed-demo", version: "0.4.0", source: Bun.spawnSync(["realpath", dir]).stdout.toString().trim(), commit: git(dir, "rev-parse", "--short=7", "HEAD"), dirty: false });
  writeFileSync(join(dir, "src/greeting.ts"), 'export const GREETING = "changed after the commit";\n');
  expect((await inspectModule(dir, context)).info.dirty).toBe(true); // uncommitted changes are embedded, and flagged
});

test("an untracked file also makes the checkout dirty", async () => {
  const dir = moduleRepo();
  writeFileSync(join(dir, "src/new.ts"), "export const x = 1;\n");
  expect(gitState(dir).dirty).toBe(true);
});

test("the build refuses a checkout that cannot be embedded, with a message that says why", async () => {
  const notGit = join(work, "plain");
  cpSync(fixtureSource, notGit, { recursive: true });
  await expect(inspectModule(notGit, context)).rejects.toThrow("não é um repositório git");

  const withDeps = moduleRepo("with-deps");
  writeFileSync(join(withDeps, "package.json"), JSON.stringify({ dependencies: { "left-pad": "1.3.0" } }));
  await expect(inspectModule(withDeps, context)).rejects.toThrow("declara dependencies (left-pad)");

  const bareImport = moduleRepo("bare-import");
  writeFileSync(join(bareImport, "src/greeting.ts"), 'import pad from "left-pad";\nexport const GREETING = pad("x");\n');
  await expect(inspectModule(bareImport, context)).rejects.toThrow("importa left-pad");

  const noDefault = moduleRepo("no-default");
  writeFileSync(join(noDefault, "src/index.ts"), "export const factory = () => ({});\n");
  await expect(inspectModule(noDefault, context)).rejects.toThrow("export default");

  const broken = moduleRepo("broken");
  writeFileSync(join(broken, "src/index.ts"), "export default (\n");
  await expect(inspectModule(broken, context)).rejects.toThrow("não compila");

  const reserved = moduleRepo("reserved");
  writeFileSync(join(reserved, "pvx-module.json"), JSON.stringify({ id: "help", version: "1.0.0", entry: "src/index.ts" }));
  await expect(inspectModule(reserved, context)).rejects.toThrow('id "help" é comando do núcleo');

  const tooNew = moduleRepo("too-new");
  writeFileSync(join(tooNew, "pvx-module.json"), JSON.stringify({ id: "too-new", version: "1.0.0", entry: "src/index.ts", pvx: ">=99.0.0" }));
  await expect(inspectModule(tooNew, context)).rejects.toThrow("requer pvx >=99.0.0");

  const badManifest = moduleRepo("bad-manifest");
  writeFileSync(join(badManifest, "pvx-module.json"), "{ nope");
  await expect(inspectModule(badManifest, context)).rejects.toThrow("manifest inválido");

  await expect(inspectModule(join(work, "missing"), context)).rejects.toThrow("não é um diretório");
});

test("a node_modules that only holds types is not a problem: nothing from it is imported", async () => {
  const dir = moduleRepo();
  mkdirSync(join(dir, "node_modules/@types/bun"), { recursive: true });
  writeFileSync(join(dir, "node_modules/@types/bun/index.d.ts"), "export {};\n");
  expect((await inspectModule(dir, context)).info.id).toBe("embed-demo");
});

test("two --with directories with the same id, or an id of a built-in, are refused", async () => {
  const first = moduleRepo("one");
  const second = moduleRepo("two");
  await expect(inspectAll([first, second], version, [])).rejects.toThrow("já pertence a um módulo embutido");
  await expect(inspectAll([first], version, ["embed-demo"])).rejects.toThrow("já pertence");
  expect((await inspectAll([first], version, ["notas"])).map((plan) => plan.info.id)).toEqual(["embed-demo"]);
});

test("the generated entry imports the checkout as it is on disk and marks each record", async () => {
  const plan = await inspectModule(moduleRepo(), context);
  const source = embeddedEntrySource([plan]);
  expect(source).toContain(`import manifest0 from ${JSON.stringify(plan.manifestPath)} with { type: "json" };`);
  expect(source).toContain(`import factory0 from ${JSON.stringify(plan.entryPath)};`);
  expect(source).toContain("__PVX_EMBEDDED__");
  expect(source).toContain('marker: "pvx-embedded-module:embed-demo"');
});

// ---------------------------------------------------------------- the real build

function runBuild(args: string[], env: Record<string, string> = {}) {
  const dist = join(work, "dist");
  const run = Bun.spawnSync(["sh", join(root, "scripts/build.sh"), ...args], {
    env: { ...process.env, PVX_DIST: dist, PVX_SKIP_DEPS: "1", PVX_RELEASE_BUILD: "", PVX_BUILD_NOW: "2026-10-15T14:32:00", ...env },
  });
  return { dist, exit: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

/** Unpacks the one tarball of a dev build and returns its binary and BUILD.txt. */
function unpack(dist: string) {
  const tarballs = readdirSync(dist).filter((name) => name.endsWith(".tar.gz"));
  expect(tarballs).toHaveLength(1);
  const where = join(work, "unpacked");
  mkdirSync(where, { recursive: true });
  expect(Bun.spawnSync(["tar", "-xzf", join(dist, tarballs[0]!), "-C", where]).exitCode).toBe(0);
  return { tarball: tarballs[0]!, bin: join(where, "pvx"), files: readdirSync(where).sort(), buildTxt: readFileSync(join(where, "BUILD.txt"), "utf8") };
}

function runBinary(bin: string, args: string[]) {
  const home = join(work, "home");
  const env = { ...process.env, PVX_HOME: home, PVX_USERMODULES: join(home, "usermodules"), PVX_CATALOG_URL: "http://127.0.0.1:9/catalog.json" };
  const run = Bun.spawnSync([bin, ...args], { env });
  return { exit: run.exitCode, out: run.stdout.toString() };
}

test("build:dev embeds a checkout: named artifact, BUILD.txt, listed in version --json, loaded without trust", () => {
  const dir = moduleRepo();
  const commit = git(dir, "rev-parse", "--short=7", "HEAD");
  writeFileSync(join(dir, "src/greeting.ts"), 'export const GREETING = "pong from an uncommitted change";\n');
  const build = runBuild(["host", "--with", dir], { PVX_DEV_BUILD: "1" });
  expect(build.exit, build.err).toBe(0);

  const packed = unpack(build.dist);
  expect(packed.tarball).toMatch(new RegExp(`^pvx-${version.replace(/\./g, "\\.")}-dev\\.20261015\\.1432-[0-9a-f]{7}(-dirty)?-host\\.tar\\.gz$`));
  expect(packed.files).toEqual(["BUILD.txt", "pvx"]);
  expect(packed.buildTxt).toContain(`pvx ${version} (dev, +embed-demo)`);
  expect(packed.buildTxt).toContain(`embed-demo 0.4.0  commit ${commit}*`);
  for (const text of [build.out, packed.buildTxt]) expect(text).toContain("embed-demo");
  expect(build.out).toContain(`scp ${build.dist}/${packed.tarball} central:/tmp/ && ssh central 'cd /tmp && tar xzf ${packed.tarball} && sudo ./pvx'`);
  expect(existsSync(join(build.dist, ".gen"))).toBe(false);

  const info = JSON.parse(runBinary(packed.bin, ["version", "--json"]).out) as { lines: { text: string; build: { label: string; buildId: string; embedded: unknown[] } }[] };
  expect(info.lines[0]!.text).toBe(`pvx ${version} (dev, +embed-demo)`);
  expect(info.lines[0]!.build.embedded).toEqual([{ id: "embed-demo", version: "0.4.0", source: Bun.spawnSync(["realpath", dir]).stdout.toString().trim(), commit, dirty: true }]);
  expect(info.lines[0]!.build.buildId).toMatch(/^dev-build:20261015\.1432-[0-9a-f]{7}/);

  // No trust.json, no prompt: the module is simply loaded, and runs the uncommitted code.
  const listed = JSON.parse(runBinary(packed.bin, ["modules", "--json"]).out) as { lines: { module: { id: string; state: string } }[] };
  expect(listed.lines.find((line) => line.module.id === "embed-demo")!.module.state).toBe("carregado");
  expect(runBinary(packed.bin, ["embed-demo", "ping"]).out).toContain("pong from an uncommitted change");
  expect(existsSync(join(work, "home/trust.json"))).toBe(false);
});

test("an installed module of the same id loses to the embedded copy in the real binary", () => {
  const build = runBuild(["host", "--with", moduleRepo()], { PVX_DEV_BUILD: "1" });
  expect(build.exit, build.err).toBe(0);
  const installed = join(work, "home/usermodules/embed-demo");
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, "pvx-module.json"), JSON.stringify({ id: "embed-demo", version: "1.0.0", entry: "index.ts" }));
  writeFileSync(join(installed, "index.ts"), 'throw new Error("the installed copy must never be imported");\n');

  const bin = unpack(build.dist).bin;
  const rows = (JSON.parse(runBinary(bin, ["modules", "--json"]).out) as { lines: { module: { id: string; version: string; embedded?: object } }[] }).lines.filter((line) => line.module.id === "embed-demo");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.module).toMatchObject({ version: "0.4.0", embedded: { id: "embed-demo" } });
  expect(readFileSync(join(installed, "index.ts"), "utf8")).toContain("must never be imported");
});

test("build:dev without --with still works: a dev build with no embedded modules and the same naming", () => {
  const build = runBuild(["host"], { PVX_DEV_BUILD: "1" });
  expect(build.exit, build.err).toBe(0);
  const packed = unpack(build.dist);
  expect(packed.tarball).toMatch(/^pvx-.+-dev\.20261015\.1432-[0-9a-f]{7}(-dirty)?-host\.tar\.gz$/);
  expect(packed.buildTxt).toContain("módulos embutidos: nenhum");
  const text = runBinary(packed.bin, ["version"]).out;
  expect(text.trim()).toBe(`pvx ${version} (dev)`);
});

test("--with is refused outside build:dev, in a release build, and for a checkout that fails validation", () => {
  const dir = moduleRepo();
  const plain = runBuild(["host", "--with", dir]);
  expect(plain.exit).toBe(2);
  expect(plain.err).toContain("--with só existe em `bun run build:dev`");

  const release = runBuild(["host", "--with", dir], { PVX_DEV_BUILD: "1", PVX_RELEASE_BUILD: "1" });
  expect(release.exit).toBe(2);
  expect(release.err).toContain("release não pode ser build:dev");

  const notGit = join(work, "plain");
  cpSync(fixtureSource, notGit, { recursive: true });
  const failed = runBuild(["host", "--with", notGit], { PVX_DEV_BUILD: "1" });
  expect(failed.exit).not.toBe(0);
  expect(failed.err).toContain("não é um repositório git");
  expect(existsSync(join(failed.dist, "pvx-host.tar.gz"))).toBe(false);
  expect(readdirSync(failed.dist).filter((name) => name.endsWith(".tar.gz"))).toEqual([]);
});

test("the build:dev script runs scripts/build.sh in dev mode", () => {
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts as Record<string, string>;
  expect(scripts["build:dev"]).toBe("PVX_DEV_BUILD=1 sh scripts/build.sh");
});

// ---------------------------------------------------------------- the release guard

function tarballWith(files: Record<string, string>): string {
  const dir = join(work, `pkg-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const tarball = `${dir}.tar.gz`;
  Bun.spawnSync(["tar", "-czf", tarball, "-C", dir, ...Object.keys(files)]);
  return tarball;
}

const guard = (tarball: string) => Bun.spawnSync(["sh", join(root, "scripts/check-artifact.sh"), tarball]);

test("the release guard refuses an artifact with embedded modules, a dev build id or the nightly mark, and a BUILD.txt", () => {
  expect(guard(tarballWith({ pvx: "binary that is a plain release\n" })).exitCode).toBe(0);
  for (const mark of ["pvx-embedded-module:firewall", "dev-build:20261015.1432-4d8baf8", "nightly, abc1234"]) {
    const refused = guard(tarballWith({ pvx: `binary with ${mark} inside\n` }));
    expect(refused.exitCode, mark).toBe(1);
    expect(refused.stderr.toString()).toContain("marca de desenvolvimento");
  }
  const withBuildTxt = guard(tarballWith({ pvx: "plain\n", "BUILD.txt": "x\n" }));
  expect(withBuildTxt.exitCode).toBe(1);
  expect(withBuildTxt.stderr.toString()).toContain("BUILD.txt");
});

test("the real dev artifact is refused by the release guard, and release.sh runs that guard", () => {
  const build = runBuild(["host", "--with", moduleRepo()], { PVX_DEV_BUILD: "1" });
  expect(build.exit, build.err).toBe(0);
  const tarball = join(build.dist, readdirSync(build.dist).find((name) => name.endsWith(".tar.gz"))!);
  expect(guard(tarball).exitCode).toBe(1);
  expect(readFileSync(join(root, "scripts/release.sh"), "utf8")).toContain('sh scripts/check-artifact.sh "$dist/pvx-$t.tar.gz"');
});
