/** SDK v1: the public module contract. Types only, plus EXIT. */

export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, NOT_FOUND: 3 } as const;

export interface Manifest {
  id: string;
  version: string;
  entry: string;
  /** Host semver range. */
  pvx?: string;
  applies?: { file?: string };
  /** Systems the module supports; unset means any. */
  os?: ("linux" | "macos" | "windows")[];
  /** Linux distro families, matched case-insensitively against `ID` and `ID_LIKE` in /etc/os-release. Implies Linux. */
  distro?: string[];
  /** `fs` entries may start with `$PVX_HOME` (the central's data dir) or `$PVX_PROFILED_DIR` (`/etc/profile.d`), expanded by the host. */
  permissions?: { exec?: string[]; net?: string[]; fs?: string[] };
  contributes?: { commands?: string[]; pages?: string[]; widgets?: string[]; capabilities?: string[] };
  /** Modules this one queries via ctx.query. */
  uses?: string[];
}

export type ModuleFactory = (sdk: Sdk) => ModuleDef;

/** A module that ships inside pvx (official, trusted, no git): its manifest and factory, listed by the host's static barrel. */
export interface BuiltinModule {
  manifest: Manifest;
  factory: ModuleFactory;
}

export interface ModuleDef {
  /** Key = command path with spaces: "ip trust-phonevox". */
  commands?: Record<string, CommandDef>;
  capabilities?: CapabilityDef[];
  queries?: Record<string, ModuleQuery>;
  /** Key = page name; opened by `#<module>.<name>` (or `#<name>` when unique). */
  pages?: Record<string, PageDef>;
  widgets?: Record<string, WidgetDef>;
  /** Jobs the host asks for by role, never by module name. At most one module may fill each role. */
  roles?: Roles;
}

/**
 * Host-defined roles. `compose` and `notesState` name one of this module's queries, `addNote` one of its commands
 * (a key of `commands`, with the module id first on the line: `"<id> add"`).
 */
export interface Roles {
  /** Query that opens the note composer (Início `n`). */
  compose?: string;
  /** Query that returns the folded notes (`{id, author, at, text, pinned, resolved, login}[]`), for the login banner. */
  notesState?: string;
  /** Command that adds a note: `<line> --tag T --ref R <text>` (`conformidade ignorar` records its reason with it). */
  addNote?: string;
}

export interface CommandDef {
  help: string;
  /** Human title of the command's form (pt-BR, e.g. "Criar o usuário no UOE"). Without it the host falls back to the command line. */
  title?: string;
  args?: ArgSpec[];
  /** Marked with ! and confirmed in the plan. */
  destructive?: boolean;
  /** Name of one of this module's pages: opened after the command runs ok. */
  page?: string;
  /** Only reads: runs without root (the host's strict-root rule skips it). Never set it on a command that mutates central data. */
  readonly?: boolean;
  run(ctx: CommandCtx): void | Promise<void>;
}

export interface ArgSpec {
  name: string;
  /** What the form calls the field, in pt-BR ("ID do cliente"). Without it the form shows the humanized name (`id-cliente` becomes "Id cliente"). */
  label?: string;
  /** One line for the CLI help. The form shows it under the focused field with any parenthesis about stdin, `PVX_SECRET_*` or prompt cut out. */
  help: string;
  kind: "positional" | "flag" | "option";
  required?: boolean;
  /** Never echoed, logged or stored; prompted at run time. */
  secret?: boolean;
  /** Completion candidates. */
  values?: string[];
  /** With `values`, the form draws the argument as a single choice among them instead of a text line: `radio` (`( ) a   (•) b`) or `buttons` (a row of buttons). */
  style?: "radio" | "buttons";
  /** Positional only, free text: when missing and stdin is not a TTY, the value is read from stdin (`echo txt | pvx <module> add`); extra words on the line are joined into it. */
  stdin?: boolean;
  /** Option only: may be given several times; the module receives the values joined by a comma. */
  repeat?: boolean;
}

export interface CommandCtx {
  args: Record<string, string | boolean | undefined>;
  /** A positional argument's text, or undefined when missing. */
  arg(name: string): string | undefined;
  /** Whether a `flag` was given. */
  flag(name: string): boolean;
  /** An `option`'s text, or undefined when missing. */
  option(name: string): string | undefined;
  /** A `repeat` option as a list: the comma-joined values split, trimmed, empty ones dropped (`[]` when missing). */
  list(name: string): string[];
  out: Out;
  log: Logger;
  store: Store;
  query: QueryFn;
  slots: SlotsApi;
  session: SessionInfo;
  /** Runs a program (no shell). Only commands whose basename is in `permissions.exec`. */
  exec(cmd: string, args?: string[], opts?: ExecOpts): Promise<ExecResult>;
  /** Helpers over `exec` (same allowlist): `run` returns the result, `must` throws a `StepError`, `ok` answers a boolean. */
  shell: Shell;
  /** The same `strategy.pick` as `sdk.strategy`, for a command that chooses its backend. */
  strategy: StrategyKit;
  /** Named phases run in order with the progress kept in the store, so a failed run resumes where it stopped. */
  phases: Phases;
  /** Only hosts (`host[:port]`) listed in `permissions.net`; redirects are not followed. */
  net: ModuleNet;
  /** Only paths under `permissions.fs` (`rw:` prefix allows write) and the module's own state dir. */
  fs: ModuleFs;
  /** Background jobs of this module: commands that outlive pvx and the SSH session. */
  jobs: Jobs;
  /** True when pvx runs as root (always true on Windows, which has no uid). Use it instead of reading the process uid. */
  isRoot: boolean;
  /** Aborted when the host stops the job this command runs in (`jobs.stop`, SIGTERM). Never aborted outside a job. */
  signal: AbortSignalLike;
  /** Writes a line to this run's job log (`log(name)`, `pvx jobs log`). Outside a job it does nothing. `out` lines go there too. */
  jobLog(line: string): void;
}

export interface JobStatus {
  /** `none`: no such job. `failed` also covers a job whose process died without reporting. */
  state: "running" | "done" | "failed" | "stopped" | "none";
  /** ms since epoch. */
  startedAt?: number;
  endedAt?: number;
  exit?: number;
  pid?: number;
}

/**
 * A job is one command of the module (`line`, without the module id) run as `pvx <module> <line>` in a detached process:
 * `systemd-run --unit pvx-<module>-<name> --collect` when available, else its own session with every fd redirected.
 * State and log live in `$PVX_HOME/modules/<id>/jobs/<name>.json|.log`. A job name is `[a-z0-9-]+`.
 */
export interface Jobs {
  /** Fails (throws) if the job is running. `secrets` (by ArgSpec name) go through a 0600 file the child deletes at start, never argv. */
  start(name: string, line: string, opts?: { secrets?: Record<string, string> }): Promise<void>;
  /** Asks the whole job to stop (SIGTERM, SIGKILL after 3 s); the state becomes `stopped`. */
  stop(name: string): Promise<void>;
  status(name: string): Promise<JobStatus>;
  list(): Promise<(JobStatus & { name: string })[]>;
  /** Log lines. `since`: skip that many lines first (poll with the count you already have); `tail`: only the last N. */
  log(name: string, opts?: { tail?: number; since?: number }): Promise<string[]>;
}

/** Who is operating pvx, as the host found out. Read-only. */
export interface SessionInfo {
  /**
   * IP (v4 or v6) of the SSH client of the operator, or `undefined` on a console or serial login. The host looks in the
   * environment (`SSH_CONNECTION`/`SSH_CLIENT`), then in the environment of the parent processes (survives `sudo`), then in the
   * `who` line of the terminal. Detected once per process, on first read.
   */
  readonly sshClient: string | undefined;
}

/** The subset of `fetch` a module needs (the SDK carries no DOM types). */
export interface NetInit {
  method?: string;
  /** Sent as given and never logged (an `Authorization` header stays out of the module log and of `core.log`). */
  headers?: Record<string, string>;
  /** Text or raw bytes. Give either `body` or `bodyFile`, not both. */
  body?: string | Uint8Array;
  /** A file streamed from disk as the body (never loaded whole into memory); the path needs read access in `permissions.fs`. */
  bodyFile?: string;
  /** Aborting cancels the request, also while its response is being read. */
  signal?: AbortSignalLike;
  /** Default 30000; the request is cancelled after it, also while its response is being read. Set it explicitly for a long transfer. */
  timeoutMs?: number;
}
/** `ctx.net.upload`: one `multipart/form-data` request whose file part streams from disk. */
export interface NetUploadInit {
  /** The file to send; the path needs read access in `permissions.fs`. */
  file: string;
  /** Form field of the file part (default `file`). */
  field?: string;
  /** Name sent for the file (default: the file's own name). */
  filename?: string;
  /** Text fields, sent before the file part (a server that streams reads them first). */
  fields?: Record<string, string>;
  /** `Content-Type` and `Content-Length` are set by the upload and replace any given here. Never logged. */
  headers?: Record<string, string>;
  /** Default `POST`. */
  method?: string;
  signal?: AbortSignalLike;
  /** Default 30000, as `fetch`: a large file needs an explicit value. */
  timeoutMs?: number;
}
export interface NetResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
/** `ctx.net`: only hosts (`host[:port]`) listed in `permissions.net`, only `http` and `https`, redirects never followed. */
export interface ModuleNet {
  fetch(url: string, init?: NetInit): Promise<NetResponse>;
  /** Sends a file as `multipart/form-data` without loading it into memory (a multi-GB archive is fine). */
  upload(url: string, init: NetUploadInit): Promise<NetResponse>;
}

/** The part of the standard `AbortSignal` that `exec` reads (the SDK carries no DOM types): pass a real `AbortSignal`. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, opts?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
export interface ExecOpts {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  /** Default 30000; the process is killed after it. Set it explicitly for long commands (an installer needs minutes). */
  timeoutMs?: number;
  /** Called per output line as it arrives. Lines split on `\n`, `\r\n` and a lone `\r`, so a progress bar redraw is a line. */
  onLine?(line: string, stream: "stdout" | "stderr"): void;
  /** Aborting kills the process group: SIGTERM, then SIGKILL after 2 s. The call still resolves, with the exit code. */
  signal?: AbortSignalLike;
  /** `false` keeps `stdout` and `stderr` of the result empty (use with `onLine` for huge outputs). Default true. */
  buffer?: boolean;
}
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface WriteOpts {
  mode?: number;
  atomic?: boolean;
}
export type FsEntryType = "file" | "dir" | "symlink" | "other";
/** One entry of a directory. A symlink is reported as itself (`symlink`), not as what it points to. */
export interface FsEntry {
  name: string;
  type: FsEntryType;
}
export interface FsStat {
  /** Bytes. */
  size: number;
  isDir: boolean;
  /** Permission bits only (`0o644`). */
  mode: number;
  /** Last modification, ms since epoch. */
  mtimeMs: number;
}
export interface FsSpace {
  totalBytes: number;
  /** What a process that is not root may still write (the `Avail` of `df`). */
  availableBytes: number;
}
export interface ModuleFs {
  read(path: string): Promise<string>;
  /** `mode` is the file's permission bits (`0o600`): the file never exists with wider ones, not even for an instant. `atomic` writes a temp file beside it and renames it over `path`, so a reader sees the old file or the whole new one. */
  write(path: string, data: string, opts?: WriteOpts): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Names in a directory, sorted. */
  list(path: string): Promise<string[]>;
  /** Like `list`, with the type of each entry (a file, a directory, a symlink), sorted by name. */
  entries(path: string): Promise<FsEntry[]>;
  /** Size, kind, permission bits and modification time of `path`, or `undefined` when it does not exist. */
  stat(path: string): Promise<FsStat | undefined>;
  /** Disk space `path` uses, in bytes, like `du -s`: a directory is summed recursively, symlinks are not followed, a hard link counts once, and an entry that vanishes or cannot be read is skipped. `0` when `path` does not exist. */
  du(path: string): Promise<number>;
  /** Total and available space of the filesystem that holds `path` (or, when `path` does not exist yet, its nearest existing parent): `df` without a process. */
  free(path: string): Promise<FsSpace>;
  /** Creates the directory and its parents. `mode` (`0o700`) is set on the directory it creates, whatever the umask says; a directory that exists is left as it is. Needs `rw:`. */
  mkdir(path: string, opts?: { mode?: number }): Promise<void>;
  /** Deletes a file (no error when it is missing). With `recursive` it deletes a directory and everything in it. Needs `rw:`; refuses `/` and a path outside the `rw:` prefixes. */
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  /** One write call with O_APPEND (file mode 0644 when created): concurrent appenders never interleave a line. Needs `rw:`. */
  append(path: string, text: string): Promise<void>;
}

/** Read-only view of the home slots: the last collected data, never re-evaluated. `undefined` until something fills it. */
export interface SlotsApi {
  read(slot: SlotId): SlotData | undefined;
}

export interface Out {
  success(text: string): void;
  warning(text: string): void;
  error(text: string): void;
  info(text: string): void;
  plain(text: string): void;
}

export interface OutLine {
  kind: "success" | "warning" | "error" | "info" | "plain";
  text: string;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** One state.json per module. Never put secrets here. */
export interface Store {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /** Reads `key`, applies `change` (it gets `undefined` when the key is missing) and stores the result, which it also returns. */
  update<T>(key: string, change: (current: T | undefined) => T): T;
}

/** Cross-module read: ctx.query("module.name", ...args). */
export type QueryFn = (name: string, ...args: unknown[]) => unknown | Promise<unknown>;

/** What `ReadCtx.fs` keeps of `ModuleFs`: the methods that only look. */
export type ReadFsMethod = "read" | "exists" | "list" | "entries" | "stat" | "du" | "free";

/**
 * Context of `prove()`, query functions and widget `data()`: READ ONLY. `store` has only `get`; `fs` has only the reads
 * (`read`, `exists`, `list`, `entries`, `stat`, `du`, `free`; no `write`, `append`, `mkdir` or `remove`). `exec` follows `permissions.exec`, with the same timeout, and each
 * call is logged. It cannot be made read-only by the host: run probes there (status, is-active, --version), never anything
 * that changes the system. Same trust model as commands.
 */
export interface ReadCtx {
  log: Logger;
  store: Pick<Store, "get">;
  query: QueryFn;
  session: SessionInfo;
  exec: CommandCtx["exec"];
  /** `shell.run` and `shell.ok` over the read-only `exec` (no `must`: a probe reports, it does not throw). */
  shell: Pick<Shell, "run" | "ok">;
  /** The same `strategy.pick` as `sdk.strategy`, for a probe or a query that asks which backend runs. */
  strategy: StrategyKit;
  /** Same as `CommandCtx.isRoot`. */
  isRoot: boolean;
  fs: Pick<ModuleFs, ReadFsMethod>;
  jobs: Pick<Jobs, "status" | "list" | "log">;
  phases: Pick<Phases, "state">;
}

/** A query function. The host calls it with `this` set to the module's `ReadCtx` (use `function` or method syntax to reach it; an arrow function just ignores it). */
export type ModuleQuery = (this: ReadCtx, name: string, ...args: unknown[]) => unknown | Promise<unknown>;

export interface CapabilityDef {
  /** "module.name", stable; key of profiles. */
  id: string;
  title: string;
  goal: string;
  /** Command that fixes it. */
  fix?: string;
  /** Capabilities to re-prove after the fix. */
  affects?: string[];
  /** Capabilities that must be ok first. */
  needs?: string[];
  /** Fix step is never auto-applied with --yes. */
  optIn?: boolean;
  /** Read-only (só leitura): no `store.set`, no `fs.write`. `ctx.exec` is for probes only. */
  prove(ctx: ReadCtx): Proof | Promise<Proof>;
}

export interface Proof {
  level: "ok" | "warn" | "error";
  text: string;
  evidence?: string;
  fix?: string;
}

/** `sdk.proof`: builders for `Proof` (a module imports types only, so the runtime comes injected). */
export interface ProofKit {
  ok(text: string, extra?: { evidence?: string }): Proof;
  warn(text: string, extra?: { fix?: string; evidence?: string }): Proof;
  error(text: string, extra?: { fix?: string; evidence?: string }): Proof;
  /** Runs the steps in order and returns the first `Proof` that is defined and not ok, or undefined when none is: a capability reads as named steps. */
  firstProblem(...steps: (() => Proof | undefined | Promise<Proof | undefined>)[]): Promise<Proof | undefined>;
}

/** An error a failed step throws: what was run, its exit code and the useful lines of its output. `shell.must` throws it; the phase runner records it. */
export interface StepError extends Error {
  name: "StepError";
  command: string;
  code: number | undefined;
  output: string[];
}

export interface ShellOpts {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  /** Default 30000, as `exec`. */
  timeoutMs?: number;
  /** Sees every output line (a package tracker, a log). */
  onLine?(line: string, stream: "stdout" | "stderr"): void;
  signal?: AbortSignalLike;
  /** `false` keeps `stdout` and `stderr` empty (the `tail` is kept anyway). */
  buffer?: boolean;
  /** What a `StepError` shows for the command instead of its argv (when the argv holds a secret). */
  display?: string;
}
export interface ShellResult extends ExecResult {
  /** The last lines of output worth keeping (progress redraws dropped), for a failure message. */
  tail: string[];
}
/** Over `ctx.exec`: the same `permissions.exec` allowlist (a violation still throws; it is never turned into an exit code). */
export interface Shell {
  /** Never throws for a bad exit. A program that cannot start answers exit 127. */
  run(command: string, args?: string[], opts?: ShellOpts): Promise<ShellResult>;
  /** Like `run`, but a bad exit throws a `StepError`. */
  must(command: string, args?: string[], opts?: ShellOpts): Promise<ShellResult>;
  /** True when the exit was 0. */
  ok(command: string, args?: string[], opts?: ShellOpts): Promise<boolean>;
  /**
   * A `Shell` for a long job: every call writes `$ <command>` to `ctx.jobLog`, then each non-blank output line (outside a job `jobLog` does
   * nothing, so only the defaults apply). The command shown is `opts.display` when given, else the argv: pass `display` whenever the argv
   * holds a secret. `stdin` is never shown, and the host also masks the job's secrets (`secrets` of `jobs.start`) in the log.
   * `defaults` fill what a call leaves out (`timeoutMs`, `buffer`, ...); `signal` defaults to `ctx.signal`, so each program runs in its own
   * process group and `jobs.stop` kills it with the job. `buffer` is `false` unless you say otherwise: a package manager prints far more than memory needs.
   */
  echoing(defaults?: ShellOpts): Pick<Shell, "run" | "must" | "ok">;
}

export type PhaseState = "pending" | "running" | "done" | "failed" | "skipped";
export interface PhaseOutcome {
  /** A short note kept with the phase ("adiado"). */
  detail?: string;
  /** Nothing to do: the phase is marked skipped, with this as the reason. */
  skipped?: string;
}
export interface PhaseDef {
  id: string;
  label: string;
  /** Share of the overall progress (default 1). */
  weight?: number;
  /**
   * `report(text)` updates the phase's detail while it runs. `progress(fraction)` (0..1, clamped) says how far the phase is: the overall
   * progress counts the finished weights plus this phase's weight times the fraction. Both write the store, so `progress` writes at most
   * every 250 ms or when the fraction moved by 1%; `report` writes each time (do not call it hundreds of times a second).
   */
  run(phase: { report(detail: string): void; progress(fraction: number): void }): void | PhaseOutcome | Promise<void | PhaseOutcome>;
}
export interface PhaseRecord {
  id: string;
  label: string;
  weight: number;
  state: PhaseState;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
  /** 0..1, set by `phase.progress` while the phase runs; gone once it finishes. */
  progress?: number;
}
export interface PhaseFailure {
  phase: string;
  message: string;
  /** Set when the cause was a `StepError`. */
  command?: string;
  code?: number;
  output?: string[];
}
/** What `phases` keeps in the store (key `phases:<name>`). */
export interface PhasesState {
  phases: PhaseRecord[];
  /** When the run began (kept across resumes). */
  startedAt: number;
  /** When the latest run (or resume) began: compare it with `JobStatus.startedAt` to tell a leftover of an older job. */
  runStartedAt: number;
  failure?: PhaseFailure;
}
/** `sdk.phases`: reads a `PhasesState` (a command's `status` prints it, a page shows it). */
export interface PhasesKit {
  /** 0..1 across the whole run: the weight of the finished phases plus the running phase's weight times its `progress`. */
  progress(state: PhasesState): number;
  /** True when every phase is done or skipped, except the `trailing` ones (ids): a countdown that is still running does not count. */
  finished(state: PhasesState, trailing?: string[]): boolean;
}
export type PhasesResult = { ok: true } | { ok: false; failedPhase: string; error: unknown };
export interface Phases {
  /**
   * Runs the phases in order and saves the state at every change. With a saved state for `name` and the same phase ids, a finished
   * phase is skipped and the others run again (a resume); `fresh: true` (or a different list of ids) starts over. It stops at the
   * first phase that throws, records why (`PhasesState.failure`) and resolves `{ ok: false }`. Each phase says so on `ctx.out`.
   */
  run(name: string, phases: PhaseDef[], opts?: { fresh?: boolean }): Promise<PhasesResult>;
  state(name: string): PhasesState | undefined;
  /** Forgets the saved state of `name`. */
  reset(name: string): void;
}

export type PackageManager = "dnf" | "apt";
/** `download`, `install` (unpack, configure) and `verify`, the three parts of a package transaction. */
export type PackagePhase = "download" | "install" | "verify";
export interface PackageRef {
  name: string;
  version: string;
  arch?: string;
  repo?: string;
  size?: string;
}
export interface RunningPackage extends PackageRef {
  phase: PackagePhase;
}
export interface PackageProgress {
  /** Packages the transaction(s) will handle; grows as they are announced. */
  total: number;
  done: PackageRef[];
  running: RunningPackage[];
  /** Names of the packages that failed. */
  failed: string[];
}
/** Reads the output of `dnf install` or `apt-get install` line by line (feed it from `onLine`). It mutates `progress` in place. */
export interface PackageTracker {
  readonly progress: PackageProgress;
  /** The part of the transaction the latest line belonged to. */
  readonly phase: PackagePhase | undefined;
  /** Applies one line; true when something a page shows changed. */
  feed(line: string): boolean;
  /** One package manager run ended. A good one commits its total and finishes what was running; a failed one marks it failed. */
  endRun(ok: boolean): void;
  /** Marks a package failed that the output did not name. */
  fail(name: string): void;
}
export interface PackagesKit {
  /** `progress` continues a saved one (a resume). */
  tracker(manager: PackageManager, progress?: PackageProgress): PackageTracker;
}

/** A way of doing something (an engine, a backend): `available` says whether this machine can use it. */
export interface Strategy {
  id: string;
  available(): boolean | Promise<boolean>;
}
export interface StrategyKit {
  /**
   * `setting` `"auto"` (or missing): the first available strategy, in the list's order, with `auto: true`; `error` (your text) when none is.
   * Any other `setting` picks that id without asking `available` (use it to explain why a chosen one cannot run); an unknown id is an `error`.
   */
  pick<Item extends Strategy>(strategies: Item[], opts: { setting?: string; none: string }): Promise<{ strategy: Item; auto: boolean } | { error: string }>;
}

/** `sdk.errors`: what a module needs to read a `StepError` (a module imports types only, so the runtime comes injected). */
export interface ErrorsKit {
  /** True for an error with the shape of a `StepError` (the one `shell.must` throws). */
  isStepError(error: unknown): error is StepError;
  /** The message of any error; for a `StepError`, also the useful lines of its output, one per line, indented. */
  describeFailure(error: unknown): string;
  /** A `StepError` for a failure that came from no `shell.must` (a check that found a problem): the phase runner records it the same way. */
  stepError(message: string, command: string, code: number | undefined, output: string[]): StepError;
}

/** `sdk.cron`: the five-field cron expressions a module puts in a crontab. Pure. */
export interface CronKit {
  /** The expression with single spaces between fields. */
  normalize(expression: string): string;
  /**
   * `undefined` when `expression` is five valid fields (minute hour day-of-month month day-of-week; `*`, `5`, `1-5`, lists with `,`, `/step`; 0 and 7 are Sunday),
   * else a pt-BR text that says which field is wrong and the range it takes. `@reboot`, names (`mon`, `jan`), `%` and quotes are refused: the text ends up in a crontab.
   */
  validate(expression: string): string | undefined;
  /** A short pt-BR text for a valid expression: `diário 03:30`, `semanal dom 02:00`, `mensal dia 5 03:30`, `a cada 15 min`, `de hora em hora`, `a cada 2 h`. Any other expression is returned normalized, as written. */
  describe(expression: string): string;
}

/** What `sdk.crontab` throws: the crontab could not be read or written, or its managed block is damaged. Nothing was changed. */
export interface CrontabError extends Error {
  name: "CrontabError";
}

/** One module's marked block of a user's crontab: the module owns the lines between the markers and touches nothing else. */
export interface CrontabBlock {
  /** `# BEGIN pvx <id> (gerenciado pelo pvx: não edite à mão)`. */
  readonly begin: string;
  /** `# END pvx <id>`. */
  readonly end: string;
  /**
   * The lines of the user's crontab (`crontab -l`, in the C locale). `[]` only when the answer is "no crontab for <user>"; any other failure
   * throws a `CrontabError`, so a hiccup can never turn into a write of an empty crontab over the real one. Needs `crontab` in `permissions.exec`.
   */
  read(shell: Pick<Shell, "run">): Promise<string[]>;
  /** The entries inside the block of `lines`, `[]` when there is none, or `{ error }` for a half, reversed or duplicated block (someone edited it by hand). */
  entries(lines: string[]): string[] | { error: string };
  /** `lines` with the block replaced by `entries` (dropped when `entries` is empty, appended when there was none). Every line outside the block stays as it was. */
  merge(lines: string[], entries: string[]): { lines: string[] } | { error: string };
  /** Reads, merges and installs (`crontab -`, the exit is checked). Returns the crontab as it was. Throws a `CrontabError` and writes nothing when the read fails or the block is damaged. */
  sync(shell: Pick<Shell, "run" | "must">, entries: string[]): Promise<string[]>;
  /** Installs `lines` as the whole crontab, checking the exit: the way back after a `sync`. */
  restore(shell: Pick<Shell, "must">, lines: string[]): Promise<void>;
  /**
   * `sync`, then `commit()` (save your state). When `commit` throws, the crontab is restored to what it was and the error is rethrown, so the crontab
   * and the state never disagree. If the restore fails too, the `CrontabError` says the crontab may still hold the new block.
   */
  update(shell: Pick<Shell, "run" | "must">, entries: string[], commit: () => void | Promise<void>): Promise<void>;
}

/** `sdk.crontab`. */
export interface CrontabKit {
  /** The block of module `id` (`meumodulo`): the markers are derived from it, so two modules never touch each other's lines. */
  block(id: string): CrontabBlock;
  /** True for the error `read`, `sync`, `restore` and `update` throw. */
  isError(error: unknown): error is CrontabError;
}

/** `sdk.validate`: helpers for the checks a command runs on what the technician typed. */
export interface ValidateKit {
  /** The first problem text of a list of checks (each one `string | undefined`, as `sdk.cron.validate` answers), or `undefined` when all pass. */
  firstProblem(...problems: (string | undefined)[]): string | undefined;
}

/** What the host injects into the factory. */
export interface Sdk {
  version: 1;
  log: Logger;
  ui: SdkUi;
  proof: ProofKit;
  /** Parsers of `dnf` and `apt` output (see `PackageTracker`). */
  packages: PackagesKit;
  /** Picks which of several strategies (backends, engines) a module drives. */
  strategy: StrategyKit;
  /** Reads and raises a `StepError`: `isStepError`, `describeFailure` and `stepError`. */
  errors: ErrorsKit;
  /** Reads the phases state: `progress` and `finished`. */
  phases: PhasesKit;
  /** Cron expressions: `validate`, `describe`, `normalize`. */
  cron: CronKit;
  /** The managed block of a crontab: `block(id)` reads, merges and writes it safely. */
  crontab: CrontabKit;
  /** `firstProblem` for validation texts. */
  validate: ValidateKit;
  /** Same permission rules as `ctx.fs`, for code that has no command context (queries, widgets). */
  fs: ModuleFs;
}

// ---- Pages and widgets (UI) ----

export interface PageDef {
  title: string;
  /** A ReactNode built with `sdk.ui.h`. Called inside the host's error boundary, so hooks may be used in it. */
  render(): unknown;
  /** Shown in the footer and in `?` while the page is on screen. Reserved (ignored): esc, ?, ctrl+c, ctrl+k. */
  keys?: KeySpec[];
  /** Also a tab in the tab bar, after the core tabs (sorted by `order`, then label). */
  tab?: boolean | { label: string; order?: number };
  /** What the host may open without naming a module: the page with role `plan` is where the plan is shown, Início goes to `notes`. */
  role?: "plan" | "notes";
}

export interface KeySpec {
  /** `a`, `space`, `enter`, `ctrl+x`, `L`. */
  keys: string;
  label: string;
  /** Only in the `?` help, not in the footer. */
  help?: boolean;
  run(): void;
}

export type Level = "ok" | "warn" | "error";
/** The tones of a `Notice` and a `Badge`: the three levels plus the blue `info`. */
export type NoticeLevel = Level | "info";

export interface FieldSpec {
  id: string;
  label: string;
  kind: "area" | "line" | "toggle" | "secret" | "choice" | "multi";
  /** Rows of an `area` (default 5). */
  rows?: number;
  /** Text beside a `toggle`'s box (the label stays in the label column). */
  text?: string;
  /**
   * How the options of a `choice` or `multi` are drawn. `list` (default): one option per line, with its `detail`. `radio` (`choice`): one row `( ) 16   (•) 18`;
   * `←` `→` move the choice and a click picks. `buttons` (`choice`): one row of buttons, the chosen one filled. `row` (`multi`): one row `[x] a   [ ] b`;
   * `←` `→` move, `espaço` marks. The row styles put the label in the label column like a `line`, and ignore `detail`.
   */
  style?: "list" | "radio" | "buttons" | "row";
  /** `choice` and `multi`. The value of a `choice` is the chosen option's `value` (the first option when `initial` has none); of a `multi`, the checked values joined by a comma (`initial` the same). */
  options?: FieldOption[];
  /** Marks the field with a subtle `*`; submitting with it empty shows "preencha este campo" under it. Not for `toggle`, `choice` or `multi`. */
  required?: boolean;
  /** An error to show under the field now (a failure the module found, such as a rejected value): it stays until the field is edited. The form's own `required` and `validate` errors work as before. */
  error?: string;
  /** A short dim hint to the right of the value. Only when it helps fill the field (a constraint: "letras, números e hífen"); never to explain the obvious or why the form is built this way. */
  help?: string;
  /**
   * `line` only: the value follows the other fields. While the technician has not edited the field it holds `derive(values)` and updates live as the
   * others change (nothing on screen says so). Editing it stops the following and keeps the typed text; clearing it to empty follows again. `values` are the current values of every field, as `onSubmit` receives them.
   */
  derive?: (values: Record<string, string | boolean>) => string;
  /** `secret` only: the key that fills the field with 24 random letters and digits (e.g. `ctrl+g`). It shows in the footer and in `?`. */
  generate?: string;
}
export interface FieldOption {
  value: string;
  label: string;
  detail?: string;
}

/**
 * Home slots. The data shape of each slot is fixed by the core; a widget that returns another shape is removed as broken.
 * Lower `priority` comes first. `home.panel` is reserved: accepted but not rendered yet (free `render()` is deferred).
 */
export type SlotId = "home.chips" | "home.attention" | "home.configured" | "home.summary" | "home.notes" | "home.panel";

export type SlotData =
  | { label: string; level: Level; detail?: string }[] // home.chips
  | { level: Level; title: string; fix?: string }[] // home.attention, home.configured
  | string // home.summary
  | string[]; // home.notes (home.panel is reserved)

export interface WidgetDef {
  slot: SlotId;
  /** Order inside the slot. */
  priority: number;
  refreshMs?: number;
  /** Read-only context. A `data()` slower than the host's limit (2 s) is removed, so give `ctx.exec` a short `timeoutMs`. */
  data(ctx: ReadCtx): SlotData | Promise<SlotData>;
}

// ---- sdk.ui: injected by the host, so a module never imports React ----

export type Tone = "ok" | "warn" | "error" | "info" | "accent" | "dim" | "text" | "ip";
/** What a job is doing, from the page's side: `stale` is a job that says it runs but has written nothing for `staleMs`. */
export type JobView = "idle" | "running" | "stale" | "done" | "failed" | "stopped";
/** What a phased run is doing: `idle` (nothing, or only what an older job left), the job's own view while it runs, `done`, `failed` (a phase failed, or the job ended before the last one). */
export type RunView = "idle" | "running" | "stale" | "done" | "failed";

/** `unknown`, not ReactNode: this package has no React types. */
export interface Kids {
  children?: unknown;
}
/** `key` is accepted on every component: lists of elements need it. */
export type Component<P> = (props: P & { key?: string | number }) => unknown;

export interface CommandRun {
  exit: number;
  lines: OutLine[];
}

/** One line of the `conformidade` result. */
export interface ConformityResult {
  level: Level;
  /** `<capability title>: <proof text>`. */
  text: string;
  /** Command that fixes it, when there is one. */
  fix?: string;
}
/** One step of the convergence plan, in the order it must run. */
export interface ConformityStep {
  cmd: string;
  /** Capability ids the step serves. */
  for: string[];
  /** Added only because an earlier step affects its target. */
  implicit: boolean;
  reason?: string;
  /** Never applied without an explicit yes. */
  optIn?: boolean;
}
export type StepAnswer = "yes" | "skip" | "stop";
export interface StepOutcome {
  step: ConformityStep;
  status: "ok" | "error" | "skipped";
  code?: number;
}

/** The host's cached conformity: the same data the Início panel shows. */
export interface Conformity {
  /** Title of the applicable profile. */
  profile?: string;
  /** Set when there is nothing to list (no applicable profile): show it as is. */
  message?: string;
  results: ConformityResult[];
  plan: { steps: ConformityStep[]; /** Pending items with no `fix`. */ manual: string[] };
  /** When the cache was filled (ms); undefined until the first check. */
  checkedAt?: number;
  running: boolean;
  /** Re-evaluates (results and plan together); a no-op while running. */
  refresh(): void;
  /**
   * Applies the plan as ordinary commands through the session (scrollback, history, log). A frozen copy of the steps runs
   * in order: `confirm` is asked before each one; stops at the first error or at "stop".
   */
  apply(confirm: (step: ConformityStep) => StepAnswer | Promise<StepAnswer>): Promise<StepOutcome[]>;
}

/** A column of `List`: `width` is fixed (never shrinks), `grow` takes a share of what is left, neither sizes to the content. */
export interface ListColumn { id: string; title?: string; width?: number; grow?: number; align?: "left" | "right" }
/** A cell of a column-mode `List` item. */
export type ListCell = string | { text: string; tone?: Tone };
export interface ListItem {
  id: string;
  /** One-string row (no columns). */
  label?: string;
  detail?: string;
  tone?: Tone;
  mark?: { text: string; tone: Tone };
  /** Cell text per `ListColumn.id`. */
  cells?: Record<string, ListCell>;
}

export interface StepItem {
  id: string;
  label: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  elapsedMs?: number;
  detail?: string;
}

/** One question of a `Conversation`. */
export interface Question {
  id: string;
  /** Shown as `? title` while asked and as `✓ title  summary` once answered. */
  title: string;
  /** Any `Fields` kind. Its `id` and `label` are ignored (the question's `id` and `title` rule). */
  field: FieldSpec;
  /** The answered line's text. Default: the option label (`choice`, `multi`), `sim`/`não` (`toggle`), `●●●●●●●●` (`secret`), the first line of the text. */
  summary?(value: string | boolean): string;
  /** Not asked in the flow, but listed (marked "(padrão)" until edited) and editable in the confirm step. Its value is `answers[id]`. */
  skip?: boolean;
}

export interface CellItem {
  id: string;
  state: "pending" | "running" | "done" | "failed";
  /** Shown under the grid for the selected or hovered cell. */
  label?: string;
}

export interface QueryState<T> {
  data?: T;
  error?: string;
  loading: boolean;
  /** Reads again now, keeping the old data until the new arrive. Call it after an action changed what the query reads. */
  refetch(): Promise<void>;
}

export interface JobState {
  status: JobStatus;
  lines: string[];
  /** `stale` while the job runs but its log did not change for `staleMs` (default 30000, counted from when the page began watching). */
  view: JobView;
  /** True until the first poll answers: `status` and `lines` are placeholders then, so show a wait, never `failed` or a start flow. */
  loading: boolean;
  start(line: string, opts?: { secrets?: Record<string, string> }): Promise<void>;
  stop(): Promise<void>;
}

export interface RunState extends Omit<JobState, "view"> {
  /** Of the whole run (see `RunView`). */
  view: RunView;
  /** Of the job alone. */
  jobView: JobView;
  state?: PhasesState;
  /** One row per phase; the times of a running phase advance by themselves (a 1 s tick while the run is `running` or `stale`). */
  steps: StepItem[];
  /** 0..1 by the weight of the phases, counting the partial `phase.progress` of the running one. */
  progress: number;
  /** False when `state` belongs to an older job than the one the host knows. */
  current: boolean;
}

/** The button at the end of a `Notice` line. Same rules as `Button`: it needs `keys` or `focused`. */
export interface NoticeAction {
  label: string;
  onPress: () => void;
  keys?: string;
  /** With `keys`: the key shows in the `?` help and not in the footer. */
  help?: boolean;
  focused?: boolean;
}

/** One row of `Details` and `CopyBlock`. */
export interface DetailItem {
  label: string;
  value: string;
  /** The value's color; the label is always dim. */
  tone?: Tone;
  /** Dim text after the value (`nftables` then `(automático)`). */
  note?: string;
}

/** What a confirmation dialog says (`useConfirm`). */
export interface ConfirmOptions {
  /** The bold first line. */
  title: string;
  /** Dim lines under the title. */
  description?: string | string[];
  /** Default "confirmar". */
  confirmLabel?: string;
  /** Default "cancelar". */
  cancelLabel?: string;
  /** The confirm button takes the error style. */
  destructive?: boolean;
}

/** A chip at the bottom left of a `Card`: colored text, or a solid chip when it needs attention. */
export interface CardChip {
  text: string;
  tone: Tone;
  solid?: boolean;
}

/** What a `Card` shows (`CardGrid` takes a list of them). */
export interface CardSpec {
  /** Selection key; unique in the grid. */
  id: string;
  /** The bold first line. */
  name: string;
  /** Right of the name: a dot and a word, in the tone (`ok` and `dim` keep the word dim, the others color it). */
  state?: { text: string; tone?: Tone; dot?: "●" | "○" };
  /** The dim second line (colored when it has a `tone`). */
  line2?: { text: string; tone?: Tone };
  /** Left of the bottom line; the ones that do not fit are dropped. */
  chips?: CardChip[];
  /** Bottom right: a version or a footnote. */
  footnote?: string;
  /** An action card: dashed border, the key in bold and the label centered, `sub` dim under it. It has no state, line or chips. */
  action?: { key: string; sub?: string };
}

export interface SdkUi {
  /** JSX factory. A module file needs the classic-runtime pragmas (jsxRuntime classic, jsx h, jsxFrag Fragment), else Bun imports React. */
  h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  Fragment: unknown;
  useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  useRef<T>(init: T): { current: T };

  /**
   * A section of the page: a header line (`1 Rotinas`, a leading `[1] ` becomes the number), the content under it and whitespace above. No border.
   * With `tone` the section is the active one (or needs attention): the header takes the tone and a `▌` gutter runs down its side. A Panel without
   * `title` and `tone` is only a container (use it as the page root).
   */
  Panel: Component<Kids & { title?: string; tone?: Tone; grow?: boolean; /** The panel gives up height when the page is short, clipping its content, so the host's tab bar and footer never disappear. Pair it with `List maxRows`. */ shrink?: boolean; /** `usePanels().ref(id)`: lets the arrows find this panel by where it is drawn. */ panelRef?: unknown; /** Mouse down anywhere in the panel (children included): lets a page that keeps its own `{ panel, inside }` focus the clicked panel. */ onPress?: () => void }>;
  /**
   * Children side by side, equal widths (give each Panel `grow` so they match in height). With `fit` each child keeps its own width, `gap` cells (default 0) separate them, and the ones that do not fit go to the next line:
   * a row of buttons, or a line made of styled pieces (`<Row fit><Text tone="accent" bold>lor</Text><Text>em</Text></Row>`).
   */
  Row: Component<Kids & { fit?: boolean; gap?: number }>;
  Text: Component<Kids & { tone?: Tone; bold?: boolean }>;
  /**
   * `● label` with the dot in the level's color. With `state` it is a filter chip instead: ` label ` filled with the accent when `on`, on the panel fill when `off`;
   * `onPress` makes it clickable (the module keeps the filter and its keys). Lay several out with `<Row fit gap={1}>`.
   */
  Chip: Component<{ label: string; level?: Level; state?: "on" | "off"; onPress?: () => void }>;
  /**
   * A thin usage bar `━━━━────` with the percentage: `lorem  ━━━━━━━━────  41%  18 de 44 GB`. `value` is 0..1, `width` the bar's cells (default 20),
   * `label` a dim prefix (pad it yourself to align several meters), `suffix` a dim text after the percentage. The bar is the accent color,
   * and the warn color above `warnAbove` (0..1, default 0.8).
   */
  Meter: Component<{ value: number; width?: number; label?: string; suffix?: string; warnAbove?: number }>;
  /**
   * A time series as `▁▂▃▅` blocks, oldest first, stretched to `width` cells (default 14). `values` are 0..`max` (default 100); `suffix` is the dim text after
   * the bar (default: the last value as a percentage when `max` is 100, else none); `label` is a dim prefix.
   */
  Spark: Component<{ values: number[]; width?: number; label?: string; suffix?: string; max?: number }>;
  /** A solid chip with bold uppercase text: ` ATIVO `. `tone` is `ok` (default), `warn`, `error` or `info`. */
  Badge: Component<{ label: string; tone?: NoticeLevel }>;
  /**
   * A label/value grid: labels dim and aligned, each value in its `tone` with an optional dim `note` after it. With `columns: 2` the items fill two
   * columns (the first half down the left, the rest down the right); below 100 terminal columns it falls back to one. Default 1.
   */
  Details: Component<{ items: DetailItem[]; columns?: 1 | 2 }>;
  /**
   * Label/value rows on a subtle panel fill (no border), for values a technician copies (an access URL, a password), and under them the button `[ copiar ]`
   * (`copyLabel`, `keys` default `c`, shown in the footer). It copies the rows as aligned `label  value` lines through `useCopy`, with `title` on the preview.
   */
  CopyBlock: Component<{ rows: DetailItem[]; copyLabel?: string; keys?: string; title?: string }>;
  /** Scrolls its children when the page is taller than the screen: `↑` `↓` a line, `pgup` `pgdn` a page, `home` `end`, and the mouse wheel. Give it a parent with a height (it grows to fill it). With `focused: false` it takes no key. */
  Scroll: Component<Kids & { focused?: boolean }>;
  KeyHint: Component<{ keys: string; label: string }>;
  Table: Component<{ columns: string[]; rows: string[][] }>;
  /**
   * Display list; `selected` is an item id. `mark` is a short colored prefix (an unread dot). With `columns`, each item draws
   * its `cells` in aligned columns (header row when a column has a `title`; `label` is ignored). Only the selected row scrolls
   * its overflowing cells back and forth (marquee); pass `selected` undefined when the list has no focus.
   * Mouse: `onPress(id)` on a mouse down on a row (it still bubbles to a `Panel` `onPress`); `onHover(id)` when the mouse
   * enters a row and `onHover(undefined)` when it leaves. The row under the mouse that is not `selected` gets a light tint
   * (panel background and a dim `›`); hover never changes `selected` by itself: the page decides in `onHover`.
   */
  List: Component<{
    items: ListItem[];
    selected?: string;
    columns?: ListColumn[];
    onPress?: (id: string) => void;
    onHover?: (id: string | undefined) => void;
    /** Draws only this many rows (the window) and keeps `selected` inside it; the header stays. Without it, every row is drawn. */
    maxRows?: number;
    /** The row's action: `enter` on the selected row (the page's footer shows it) and a click on a row call it. It opens the row's form (`Fields` with `onDelete`). Do not also map `enter` to the same thing in the page. */
    onAction?: (id: string) => void;
    /** The footer label of the `enter` key (default "abrir"). */
    actionLabel?: string;
    /** Default true: a click opens the action. With `false` a click only selects (`onPress`); `enter`, or a click on the row that is already selected, opens it. */
    actionOnClick?: boolean;
  }>;
  /**
   * Form of one of the module's commands, generated from its `ArgSpec` list (`label`, `required`, `secret`, `help`) and drawn by `Fields`:
   * no box, a header line with `title` (default: the command's `title`, else the command line), the buttons `[ submitLabel ]` (default "executar")
   * and `[ cancelar ]`. No command line on screen by default; `ctrl+d` shows it dim. Secrets reach the command through the environment, never the line.
   */
  Form: Component<{ command: string; title?: string; description?: string; submitLabel?: string; /** Derived fields by argument name (`FieldSpec.derive`): `{ "root-path": (v) => `clientes/${v["id-cliente"]}-${v.empresa}` }`. The values are keyed by argument name. */ derive?: Record<string, (values: Record<string, string | boolean>) => string>; onRun?: (result: CommandRun) => void; onCancel?: () => void }>;
  Spacer: Component<{ size?: number }>;
  /** Phases of a long task, one row each: `✓` done, a spinner running, `○` pending, `✗` failed, `-` skipped. The spinner ticks only while an item is running. */
  Steps: Component<{ items: StepItem[] }>;
  /** Scrolling log: follows the end until the user scrolls up with the mouse wheel, and resumes at the end. Give it a parent with a height (it grows to fill it). */
  LogTail: Component<{ lines: string[]; follow?: boolean; /** Takes the keyboard: up/down a line, pgup/pgdn a page, home the start, end the end (and follows again). Default false: the page owns the keys. */ focused?: boolean }>;
  /**
   * An inline result block: `[✓]`, `[!]`, `[✗]` or `[i]` (blue) in the level's color and the text beside it (several lines allowed). Theme tokens only.
   * With `action` a button sits at the end of the line (`[ resolver ]`); like any `Button` it needs `keys` or `focused`.
   */
  Notice: Component<Kids & { level: NoticeLevel; action?: NoticeAction }>;
  /**
   * An editable form (no box: a header line, one row per field with a visible input cell, the focused field's `help` under the form, then the buttons):
   * `area` (multiline), `line` (one line), `toggle` (checkbox), `secret` (masked line), `choice` (radio) and
   * `multi` (checkbox list) fields, then the buttons
   * [ salvar ] and [ cancelar ] (always there) and [ remover ] (only with `onDelete`). It owns the keyboard while mounted:
   * up/down and tab/shift+tab move across fields and buttons (wrapping; in an `area` only tab moves), left/right move the cursor
   * in a `line` and between buttons, enter goes to the next field (submits on the last), toggles a `toggle` or presses a button,
   * space toggles, ctrl+s calls `onSubmit` with every value, esc calls `onCancel`. Mouse: click focuses a field, toggles a checkbox, presses a button.
   */
  Fields: Component<{
    fields: FieldSpec[];
    initial?: Record<string, string | boolean>;
    onSubmit: (values: Record<string, string | boolean>) => void;
    onCancel: () => void;
    /** Runs before `onSubmit`: return `{ fieldId: "message" }` to show it under that field and block the submit (the first one gets the focus). */
    validate?: (values: Record<string, string | boolean>) => Record<string, string> | void;
    /** Adds the destructive button. Activating it asks "remover? enter confirma · esc volta" before calling this. */
    onDelete?: () => void | Promise<void>;
    /** Label of that button (default "remover"). */
    deleteLabel?: string;
    /** The dialog that asks before `onDelete` runs (`useConfirm`): defaults to the title `<deleteLabel>?`, the buttons `[ deleteLabel ]  [ cancelar ]`, destructive. */
    deleteConfirm?: Partial<ConfirmOptions>;
    /** The id of the field that has the focus when the form opens (default: the first). */
    initialFocus?: string;
    /** `false` while the form is a parked part of a bigger flow (`Conversation` uses it): it draws no cursor, owns no key and adds nothing to the footer. Default true. */
    active?: boolean;
    /** `false` hides [ salvar ], [ cancelar ] and [ remover ]: enter on the last field or ctrl+s submits, esc cancels. Default true. */
    buttons?: boolean;
    /** With it, an up/down arrow past the first/last field calls it instead of wrapping. `tab` on the last stop and `shift+tab` on the first never wrap: they go to the host (the next or previous tab). */
    onEdge?: (dir: "up" | "down") => void;
    /** Header line of the form (bold), written once (no box). */
    title?: string;
    /** One dim line under the title. */
    description?: string;
    /** Label of the primary button (default "salvar"). */
    submitLabel?: string;
    /** A dim one-liner hidden behind `ctrl+d` ("detalhes"), built from the current values. Off by default. */
    details?: (values: Record<string, string | boolean>) => string;
  }>;

  /**
   * A guided question flow. Questions (those without `skip`) appear one at a time as `? title` with the field under it; an answered one
   * collapses to `✓ title   summary`, and the next pending one shows as `○ title`. `answers` is the module's state (controlled): the
   * flow calls `onAnswer(id, value)` as each question is answered and reads the values (and initial values) back from `answers`.
   * After the last question comes the CONFIRM step: every question (skipped ones too, with "(padrão)"), your `footerSummary`
   * (the "before you install" notes) and the primary button; `onConfirm(answers)` runs only from it, so nothing is committed before.
   * Keyboard: enter answers; up/down walk the answered lines (up from the first field of the question moves into them, down from the
   * last one returns); enter on an answered line reopens it in place, and after re-confirming the flow returns to where it was; esc
   * cancels a reopened question, leaves the list, and at the top calls `onCancel` (default: the page's `pop`). In the confirm step
   * `ctrl+enter` confirms. Mouse: click an answered line to reopen it, a button to press it. It needs a page (it adds footer rows).
   */
  Conversation: Component<{
    questions: Question[];
    answers: Record<string, string | boolean>;
    onAnswer: (id: string, value: string | boolean) => void;
    onConfirm: (answers: Record<string, string | boolean>) => void;
    /** Drawn above the lines (an already-answered check, a breadcrumb). */
    header?: unknown;
    /** Drawn in the confirm step, above the buttons: the module's notes (`Text` lines, a `Panel`). */
    footerSummary?: unknown;
    /** Label of the primary button (default "confirmar"). */
    confirmLabel?: string;
    /** Adds [ cancelar ] to the confirm step and runs on esc at the top. */
    onCancel?: () => void;
  }>;
  /**
   * `[ label ]` in the accent color, clickable; hover and `focused` fill it. `primary` is a filled accent chip ` label `; `danger` uses the error color (`[ remover ]`, filled when focused).
   * `disabled` takes the reason (`disabled="falta o token"`): the button is dim, ignores the mouse and the key, and the reason shows under it. `keys` (`enter`, `ctrl+enter`, `a`) registers the key
   * for the page, so the footer and `?` show it. `focused` draws it selected (for a button the page navigates to by keyboard).
   */
  Button: Component<{ label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: string; keys?: string; /** With `keys`: the key shows in the `?` help and not in the footer (a page with many buttons keeps its footer to ~5 rows). */ help?: boolean; focused?: boolean }>;
  /**
   * One card (a box with a name, a state, a dim line, chips and a footnote). `state` is how the page draws it: `selected` has the accent border,
   * `inactive` a muted border and a `›` (the selection while the keyboard is elsewhere), `normal` a faint border. An `action` card is dashed.
   * `width` defaults to one cell of the grid at the current terminal width. A page that navigates among cards uses `CardGrid`.
   */
  Card: Component<{ card: CardSpec; state?: "normal" | "selected" | "inactive"; width?: number; onPress?: () => void }>;
  /**
   * Cards in a grid: 3 columns from 120 terminal columns, 2 from 80, else 1. `focused` is "the grid owns the keyboard": arrows move `selected`
   * (by id, the first card when unknown), `enter` and a click call `onActivate`, up on the first row calls `onTop`. Without `focused` the grid takes no key
   * and the selected card keeps a muted border. The grid grows to fill its parent and scrolls to the selected card.
   */
  CardGrid: Component<{ cards: CardSpec[]; selected?: string; onSelect: (id: string) => void; onActivate: (id: string) => void; focused: boolean; onTop?: () => void; /** Shown when there are no cards. */ empty?: unknown }>;
  /**
   * The confirm dialog (`useConfirm`) drawn in place, as a preview: no backdrop, no key, no answer. For a sheet or a help page that shows what the question will look like;
   * the real one is `useConfirm`. The buttons are drawn as the dialog draws them (`focused` is the one that looks selected: default the cancel, the safe one).
   */
  ConfirmPreview: Component<ConfirmOptions & { focused?: "confirm" | "cancel" }>;
  /**
   * One full-width line: a `━` bar, the percentage and the times. `value` is 0..1. With `startedAt` (ms since epoch) it shows the elapsed
   * time and, while running, `faltam ~` the rest (from `etaMs`, the expected TOTAL duration; without it from the pace so far); it ticks each second.
   * `failed` paints the cells at the stop point red right after the filled part and says `falhou em`; `done` fills it and says `concluído em`.
   */
  ProgressBar: Component<{ value: number; startedAt?: number; etaMs?: number; state?: "running" | "failed" | "done"; label?: string }>;
  /**
   * One cell per item (`▪` done, running and failed in their tones; `▫` pending), wrapped to the width, with a legend of the counts
   * (only the states that exist). Hover tints a cell, and moves the selection while the grid has the keyboard; click selects it and calls
   * `onPress(id)`. The keyboard (arrows move, enter presses) is on while the page has focus, or when `focused` says so; at an edge an
   * arrow is left to the page. The label of the selected or hovered cell shows under the grid.
   */
  CellGrid: Component<{ cells: CellItem[]; onPress?: (id: string) => void; legend?: boolean; focused?: boolean }>;
  /**
   * A phased run while it goes and after it ends, drawn from the `run` that `useRun` returned (the module keeps `useRun`, the start flow and what `done` means):
   * the bar (`ProgressBar`, with `etaMs` the expected total) and the state word, the phases (`Steps`), the failure, the module's `children`, and the job log (`LogTail`).
   * The failure is a `Notice` (`<phase> falhou`, or `execução parada` as a warning when the technician stopped the job), then the command, the exit code and the last
   * lines of output of a `StepError` (any other failure shows its message), the module's `cause(failure)` text under `causa provável` when it has one, and, with `onResume`,
   * the button `[ continuar daqui ]` (`enter`). Keys: `x` stops the job while it runs (`onStop`, default `run.stop()`; a refusal such as missing root shows in the footer),
   * `c` copies the failure's command and output. `esc` calls `onExit`. While `run.loading` or `run.view` is `idle` it shows a `Loading` with `loadingLabel`: mount it
   * when a run exists. Needs a page.
   */
  RunPanel: Component<Kids & { run: RunState; etaMs?: number; onResume?: () => void; onStop?: () => void; onExit?: () => void; cause?: (failure: PhaseFailure) => string | undefined; loadingLabel?: string }>;
  /** A spinner and `label`, for any wait longer than ~300 ms. The spinner ticks only while it is mounted. */
  Loading: Component<{ label: string }>;
  /**
   * Runs `fn` on mount and again when `deps` change (or on `run()`). `loading` is true while a call is out; `data` keeps the last result
   * meanwhile; `error` is the message of a throw. Only the newest call lands (an older one that finishes late is dropped).
   */
  useAsync<T>(fn: () => T | Promise<T>, deps: readonly unknown[]): { loading: boolean; data?: T; error?: string; run(): Promise<void> };
  /**
   * `copy(text, { title? })` puts `text` on the clipboard (the host and the terminal's OSC 52, so it works over SSH when the terminal allows it),
   * shows a panel with exactly the copied lines for a few seconds, and the notice `✓ copiado`. It resolves true when copied. When no clipboard
   * answers it shows `não copiou` with the cause (the panel stays, so the text can be selected with the mouse) and resolves false.
   */
  useCopy(): (text: string, opts?: { title?: string }) => Promise<boolean>;
  /**
   * Runs `line` (a command of this module) through the session: it lands in the scrollback and the history. `secrets` (by the `ArgSpec` name of
   * a `secret` argument, as `{ token: "..." }`) go to the command the way a `Form` hands them over, through the environment of that run only:
   * never in the argv, the scrollback line, the history, the state or the log.
   */
  useCommand(line: string): { run(opts?: { args?: string[]; stdin?: string; secrets?: Record<string, string> }): Promise<CommandRun>; running: boolean; lastResult?: CommandRun };
  /** Same, and re-runs every `refreshMs` (min 500) while the page is mounted. The old data stays until the new arrives (`loading` is only true for the first run). */
  useQuery<T = unknown>(name: string, args: unknown[], opts: { refreshMs: number }): QueryState<T>;
  /** Calls `ctx.query`-style: `useQuery("module.name", ...args)`. Re-runs when name or args change. */
  useQuery<T = unknown>(name: string, ...args: unknown[]): QueryState<T>;
  /** A job of this module, polled every second. It re-renders only when the status or the last `tail` lines (default 200) changed. `start` and `stop` need root like any command. */
  useJob(name: string, opts?: { tail?: number; staleMs?: number }): JobState;
  /**
   * A phased run (`ctx.phases.run(name, ...)` inside the job `name`): the job plus the phases the command keeps in the store, polled every second.
   * `steps` feed `Steps`, `progress` feeds `ProgressBar`, `view` says what to show (`done` stays done after the job went away),
   * and `current` is false when `state` is a leftover of an older job (show the start flow, not the run). `start` runs `line`
   * as the job; the command resumes by itself when it calls `ctx.phases.run` again. While `loading` the view is `idle`.
   * `trailing` lists phase ids (a final countdown, a reboot) that do not hold the run back: once every other phase is done the view is `done`,
   * even while a trailing one still runs; a failed phase (trailing or not) is still `failed`.
   */
  useRun(name: string, opts?: { tail?: number; staleMs?: number; trailing?: string[] }): RunState;
  /** This module's own store (one state.json). */
  useStore(): Store;
  /** Pages of this module only: `push("name")`, `pop()`. */
  useRouter(): { push(page: string): void; pop(): void };
  /**
   * Adds a key to the page while the calling component is mounted. Call it in render: `handler` closes over the
   * component state. The key joins the footer and `?`. Reserved (ignored): esc, ?, ctrl+c, ctrl+k.
   */
  useKey(keys: string, label: string, handler: () => void, opts?: { help?: boolean }): void;
  /**
   * While mounted with a function, `esc` calls it and stays on the page, instead of leaving (tab bar, or back from a pushed page).
   * With `undefined` the default applies, so `useBack(inside ? leave : undefined)` works. With several mounted, the most recently mounted one that has a function wins.
   */
  useBack(fn?: () => void): void;
  /**
   * True while the page receives keys: in a tab, the tab is active and the tab bar is not focused; on a pushed page, while it is the top screen.
   * The page re-renders when it changes. Use it to draw the focused panel only while the page has focus (Início does).
   */
  usePageFocused(): boolean;
  /**
   * Shows the host's short notice ("nada aqui") for a key that has no effect. With a `tone` it shows a result instead: `ok`
   * (accent), `warn` or `error`, each with its glyph, in the theme color, for about 4 s.
   */
  useNudge(): (msg?: string, tone?: "ok" | "warn" | "error") => void;
  /**
   * Asks for a confirmation in a dialog centered on the screen, the page behind it dimmed: the bold `title`, the dim `description`, then
   * `[ confirmLabel ]  [ cancelLabel ]` (defaults `confirmar` and `cancelar`). Focus starts on the cancel button, the safe one. `←` `→` and
   * `tab` move between the buttons, `enter` picks, `esc` cancels, a click picks. `destructive` draws the confirm button in the error style.
   * It resolves true only on the confirm button. The CLI keeps its own text prompt; this is for the TUI pages.
   */
  useConfirm(): (options: ConfirmOptions) => Promise<boolean>;
  /** The host's conformity cache (profile results and plan). Read-only: it never runs by itself; call `refresh()`. */
  useConformity(): Conformity;
  /**
   * Spatial focus between sibling panels. Give each navigable `Panel` `panelRef={p.ref(id)}`; `p.pick(current, dir)`
   * returns the id of the nearest panel on screen in that direction (by where they are drawn, so it follows the layout), or undefined.
   */
  usePanels(): {
    ref(id: string): unknown;
    /** Focuses the tab bar (what `step` signals with `bar`). Does nothing when the page is not in a tab. */
    toBar(): void;
    pick(current: string, dir: "left" | "right" | "up" | "down"): string | undefined;
    /** `index` moved by `delta` in a list of `count` rows, wrapping at both ends (`count` 0 gives 0). Use it for the `move` of `step`. */
    wrap(index: number, delta: number, count: number): number;
    /**
     * The host's two-level focus rule for one key, from the state `{ panel, inside }` (keep it with `useState`).
     * Panel level: arrows pick the panel on that side; `enter` goes inside a panel with `size(id)` > 0 items.
     * Inside: `up`/`down` give `move` (-1/1; the page owns the list and its edges), `enter` gives `act`, `esc` leaves.
     * `bar`: up with no panel above. `nudge`: a message to show. Undefined: the key is not handled.
     */
    step(
      focus: { panel: string; inside: boolean },
      key: "left" | "right" | "up" | "down" | "enter" | "esc",
      size: (id: string) => number,
    ): { panel: string; inside: boolean; move?: -1 | 1; act?: true; bar?: true; nudge?: string } | undefined;
  };
  /** Terminal size in cells: a page has no scroll, so a long list windows itself by it. */
  useViewport(): { cols: number; rows: number };
  /** Color tokens (`c`) and glyphs (`g`) of the active theme. */
  useTheme(): { c: Readonly<Record<string, string>>; g: Readonly<Record<string, string>> };
}
