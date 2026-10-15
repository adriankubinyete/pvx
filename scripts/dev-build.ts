// Build tooling, not the pvx binary: the dev side of scripts/build.sh (`bun run build:dev <target> --with <dir>...`).
// `plan` validates the module checkouts and writes, under <dist>/.gen, everything build.sh needs: the entry that embeds them,
// the build marks, the artifact name, BUILD.txt and the copy hint. The functions are pure where they can be, for the tests.
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join, resolve, sep } from "node:path";
import { devMark, EMBEDDED_GLOBAL, readManifestRaw, RESERVED, type EmbeddedInfo } from "@pvx/core";
import type { Manifest } from "@pvx/sdk";

/** A checked module checkout, ready to be embedded. */
export interface EmbeddedPlan {
  info: EmbeddedInfo;
  manifestPath: string;
  entryPath: string;
}

export interface GitState {
  commit: string;
  dirty: boolean;
}

/** Everything the summary, the marks and the file name need. */
export interface BuildFacts {
  version: string;
  target: string;
  now: Date;
  host: GitState;
  modules: EmbeddedInfo[];
}

const COMMIT_LENGTH = 7;
const REMOTE_HOST = "central";
const REMOTE_DIR = "/tmp";
/** Written only into the generated entry (never into a host source file), so the release guard finds it in a dev binary. */
const EMBEDDED_MARKER = "pvx-embedded-module:";
const DEV_BUILD_PREFIX = "dev-build:";

// ---------------------------------------------------------------- git

function runGit(dir: string, args: string[]): { ok: boolean; text: string } {
  const run = Bun.spawnSync(["git", "-C", dir, ...args]);
  return { ok: run.exitCode === 0, text: run.stdout.toString().trim() };
}

/** Short sha of HEAD and whether the tree under `dir` has changes (tracked or not). Throws outside a git repository. */
export function gitState(dir: string): GitState {
  const head = runGit(dir, ["rev-parse", `--short=${COMMIT_LENGTH}`, "HEAD"]);
  if (!head.ok) throw new Error(`${dir} não é um repositório git com commit: o build dev registra o commit de cada módulo`);
  const status = runGit(dir, ["status", "--porcelain", "--", "."]);
  return { commit: head.text, dirty: status.text !== "" };
}

// ---------------------------------------------------------------- names and texts

const pad = (value: number) => String(value).padStart(2, "0");

/** `20261015.1432`, local time of the machine that builds. */
export function stamp(now: Date): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${day}.${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** `4d8baf8` or `4d8baf8-dirty`: the host checkout as the file name carries it. */
export function hostLabel(host: GitState): string {
  return host.dirty ? `${host.commit}-dirty` : host.commit;
}

/** The artifact name without extension: `pvx-0.1.2-dev.20261015.1432-4d8baf8[-dirty]-linux-amd64`. */
export function artifactStem(facts: BuildFacts): string {
  return `pvx-${facts.version}-dev.${stamp(facts.now)}-${hostLabel(facts.host)}-${facts.target}`;
}

/** What `version --json` reports as `build`: it also marks the binary for scripts/check-artifact.sh. */
export function buildId(facts: BuildFacts): string {
  return `${DEV_BUILD_PREFIX}${stamp(facts.now)}-${hostLabel(facts.host)}`;
}

export function versionLabel(facts: BuildFacts): string {
  const mark = devMark(facts.modules.map((info) => info.id));
  return `${facts.version} (${mark})`;
}

/** `2026-10-15 14:32`, local time. */
export function timeText(now: Date): string {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${day} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

const commitText = (state: GitState) => (state.dirty ? `${state.commit} (alterações não commitadas)` : state.commit);
const moduleCommit = (info: EmbeddedInfo) => (info.dirty ? `${info.commit}*` : info.commit);

function moduleLine(info: EmbeddedInfo): string {
  return `  ${info.id} ${info.version}  commit ${moduleCommit(info)}  ${info.source}`;
}

/** The text of BUILD.txt, also printed at the end of the build. */
export function buildSummary(facts: BuildFacts): string {
  const lines = [
    `pvx ${versionLabel(facts)}`,
    `versão:   ${facts.version}`,
    `build:    ${timeText(facts.now)}`,
    `host:     ${commitText(facts.host)}`,
    `alvo:     ${facts.target}`,
  ];
  if (!facts.modules.length) lines.push("módulos embutidos: nenhum");
  else lines.push("módulos embutidos (* = alterações não commitadas):", ...facts.modules.map(moduleLine));
  return `${lines.join("\n")}\n`;
}

/** The copy-and-run line for a Unix target; a Windows build is an `.exe` to copy by hand. */
export function copyHint(facts: BuildFacts, artifactPath: string): string {
  const name = artifactPath.split("/").pop()!;
  if (facts.target.startsWith("windows")) return `copie ${artifactPath} para o servidor e rode o .exe`;
  return `scp ${artifactPath} ${REMOTE_HOST}:${REMOTE_DIR}/ && ssh ${REMOTE_HOST} 'cd ${REMOTE_DIR} && tar xzf ${name} && sudo ./pvx'`;
}

// ---------------------------------------------------------------- validating a module checkout

export interface CheckContext {
  hostVersion: string;
  /** Ids that a module may not take: the built-ins and the modules already chosen (core commands are checked apart). */
  taken: ReadonlySet<string>;
}

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

function readPackageJson(dir: string): Record<string, unknown> | undefined {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function assertNoDependencies(dir: string): void {
  const pkg = readPackageJson(dir);
  if (!pkg) return;
  for (const field of DEPENDENCY_FIELDS) {
    const declared = Object.keys((pkg[field] as object | undefined) ?? {});
    if (declared.length) throw new Error(`${dir} declara ${field} (${declared.join(", ")}): um módulo importa só tipos do SDK e arquivos relativos; remova as dependências`);
  }
}

function assertManifestFits(manifest: Manifest, context: CheckContext): void {
  if (RESERVED.includes(manifest.id)) throw new Error(`id "${manifest.id}" é comando do núcleo`);
  if (context.taken.has(manifest.id)) throw new Error(`id "${manifest.id}" já pertence a um módulo embutido ou ao pvx`);
  if (manifest.pvx !== undefined && !Bun.semver.satisfies(context.hostVersion, manifest.pvx)) {
    throw new Error(`requer pvx ${manifest.pvx}, e este build é ${context.hostVersion}`);
  }
}

function resolveEntry(root: string, manifest: Manifest): string {
  let entry: string;
  try {
    entry = realpathSync(join(root, manifest.entry));
  } catch {
    throw new Error(`entry "${manifest.entry}" não encontrado`);
  }
  if (!entry.startsWith(root + sep)) throw new Error(`entry "${manifest.entry}" fora do diretório do módulo`);
  return entry;
}

const isRelative = (path: string) => path.startsWith(".") || path.startsWith("/");
const isRuntimeBuiltin = (path: string) => path.startsWith("node:") || path.startsWith("bun:") || isBuiltin(path);

/** Bundles the entry with packages left external, so any package the module imports at run time stays visible in the output. */
async function bundleWithExternalPackages(entry: string): Promise<string> {
  try {
    const built = await Bun.build({ entrypoints: [entry], target: "bun", packages: "external" });
    return await built.outputs[0]!.text();
  } catch (error) {
    const logs = ((error as { errors?: { message?: string }[] }).errors ?? []).slice(0, 3);
    const detail = logs.map((log) => log.message).join("; ") || (error as Error).message;
    throw new Error(`o código do módulo não compila: ${detail}`);
  }
}

/** A module may import only relative files and runtime built-ins (type imports are erased): nothing from a node_modules gets bundled. */
export async function assertOnlyRelativeImports(entry: string): Promise<void> {
  const output = await bundleWithExternalPackages(entry);
  const scan = new Bun.Transpiler({ loader: "js" }).scan(output);
  if (!scan.exports.includes("default")) throw new Error("entry não exporta uma função por padrão (export default)");
  const packages = scan.imports.map((found) => found.path).filter((path) => !isRelative(path) && !isRuntimeBuiltin(path));
  if (packages.length) {
    const unique = [...new Set(packages)].join(", ");
    throw new Error(`importa ${unique}: um módulo importa só tipos do SDK (\`import type\`) e arquivos relativos, com JSX clássico (\`@jsxRuntime classic\`); um node_modules dele não entra no binário`);
  }
}

/** Checks one `--with` directory and records what the binary will carry. Throws a pt-BR Error that names the directory. */
export async function inspectModule(dir: string, context: CheckContext): Promise<EmbeddedPlan> {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error("não é um diretório");
    const root = realpathSync(dir);
    const manifest = readManifestRaw(root);
    assertManifestFits(manifest, context);
    assertNoDependencies(root);
    const entryPath = resolveEntry(root, manifest);
    await assertOnlyRelativeImports(entryPath);
    const git = gitState(root);
    const info: EmbeddedInfo = { id: manifest.id, version: manifest.version, source: root, commit: git.commit, dirty: git.dirty };
    return { info, manifestPath: join(root, "pvx-module.json"), entryPath };
  } catch (error) {
    throw new Error(`--with ${dir}: ${(error as Error).message}`);
  }
}

/** Plans every directory in order; a repeated id fails because the first one is `taken` by then. */
export async function inspectAll(dirs: readonly string[], hostVersion: string, builtinIds: readonly string[]): Promise<EmbeddedPlan[]> {
  const taken = new Set(builtinIds);
  const plans: EmbeddedPlan[] = [];
  for (const dir of dirs) {
    const plan = await inspectModule(resolve(dir), { hostVersion, taken });
    taken.add(plan.info.id);
    plans.push(plan);
  }
  return plans;
}

// ---------------------------------------------------------------- the generated entry

const quoted = (text: string) => JSON.stringify(text);

function recordSource(plan: EmbeddedPlan, index: number): string {
  const marker = `${EMBEDDED_MARKER}${plan.info.id}`;
  return `  { manifest: manifest${index}, factory: factory${index}, info: ${JSON.stringify(plan.info)}, marker: ${quoted(marker)} },`;
}

function importLines(plan: EmbeddedPlan, index: number): string[] {
  return [`import manifest${index} from ${quoted(plan.manifestPath)} with { type: "json" };`, `import factory${index} from ${quoted(plan.entryPath)};`];
}

/** The entry that carries the modules: static imports of the checkouts as they are on disk, then the list the app reads. */
export function embeddedEntrySource(plans: readonly EmbeddedPlan[]): string {
  const imports = plans.flatMap(importLines);
  const records = plans.map(recordSource);
  return [...imports, `(globalThis as any).${EMBEDDED_GLOBAL} = [`, ...records, "];", ""].join("\n");
}

// ---------------------------------------------------------------- the plan command

const shellValue = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

/** What build.sh sources: the marks and the artifact name. All values come from ids, versions and hashes, never from paths. */
export function planEnvSource(facts: BuildFacts): string {
  const values: Record<string, string> = {
    mark: devMark(facts.modules.map((info) => info.id)),
    build_id: buildId(facts),
    stem: artifactStem(facts),
  };
  return Object.entries(values).map(([name, value]) => `${name}=${shellValue(value)}\n`).join("");
}

interface PlanArgs {
  dist: string;
  target: string;
  dirs: string[];
}

function parsePlanArgs(argv: string[]): PlanArgs {
  const [dist, target, ...rest] = argv;
  if (!dist || !target) throw new Error("uso: dev-build.ts plan <dist> <alvo> [--with <dir>]...");
  const dirs: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] !== "--with" || !rest[index + 1]) throw new Error(`argumento inesperado: ${rest[index]} (use --with <diretório>)`);
    dirs.push(rest[++index]!);
  }
  return { dist, target, dirs };
}

function builtinIds(root: string): string[] {
  const glob = new Bun.Glob("*/pvx-module.json");
  return [...glob.scanSync({ cwd: join(root, "packages/builtin") })].map((file) => file.split("/")[0]!);
}

function buildTime(): Date {
  const forced = process.env.PVX_BUILD_NOW;
  return forced ? new Date(forced) : new Date();
}

async function runPlan(argv: string[]): Promise<void> {
  const args = parsePlanArgs(argv);
  const root = resolve(import.meta.dir, "..");
  const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  const plans = await inspectAll(args.dirs, version, builtinIds(root));
  const facts: BuildFacts = { version, target: args.target, now: buildTime(), host: gitState(root), modules: plans.map((plan) => plan.info) };
  const gen = join(resolve(args.dist), ".gen");
  mkdirSync(gen, { recursive: true });
  writeFileSync(join(gen, "embedded.ts"), embeddedEntrySource(plans));
  writeFileSync(join(gen, "plan.env"), planEnvSource(facts));
  writeFileSync(join(gen, "BUILD.txt"), buildSummary(facts));
  const artifact = args.target.startsWith("windows") ? `${artifactStem(facts)}.exe` : `${artifactStem(facts)}.tar.gz`;
  writeFileSync(join(gen, "HINT.txt"), `${copyHint(facts, `${args.dist}/${artifact}`)}\n`);
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command !== "plan") throw new Error("uso: dev-build.ts plan <dist> <alvo> [--with <dir>]...");
    await runPlan(rest);
  } catch (error) {
    console.error(`build: ${(error as Error).message}`);
    process.exit(2);
  }
}
