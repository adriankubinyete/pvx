/** SDK v1: the public module contract. Types only, plus EXIT. */

export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, NOT_FOUND: 3 } as const;

export interface Manifest {
  id: string;
  version: string;
  entry: string;
  /** Host semver range. */
  pvx?: string;
  applies?: { file?: string };
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
  queries?: Record<string, QueryFn>;
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
  help: string;
  kind: "positional" | "flag" | "option";
  required?: boolean;
  /** Never echoed, logged or stored; prompted at run time. */
  secret?: boolean;
  /** Completion candidates. */
  values?: string[];
  /** Positional only, free text: when missing and stdin is not a TTY, the value is read from stdin (`echo txt | pvx <module> add`); extra words on the line are joined into it. */
  stdin?: boolean;
  /** Option only: may be given several times; the module receives the values joined by a comma. */
  repeat?: boolean;
}

export interface CommandCtx {
  args: Record<string, string | boolean | undefined>;
  out: Out;
  log: Logger;
  store: Store;
  query: QueryFn;
  slots: SlotsApi;
  /** Runs a program (no shell). Only commands whose basename is in `permissions.exec`. */
  exec(cmd: string, args?: string[], opts?: ExecOpts): Promise<ExecResult>;
  /** Only hosts (`host[:port]`) listed in `permissions.net`; redirects are not followed. */
  net: { fetch(url: string, init?: NetInit): Promise<NetResponse> };
  /** Only paths under `permissions.fs` (`rw:` prefix allows write) and the module's own state dir. */
  fs: ModuleFs;
}

/** The subset of `fetch` a module needs (the SDK carries no DOM types). */
export interface NetInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface NetResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface ExecOpts {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  /** Default 30000; the process is killed after it. */
  timeoutMs?: number;
}
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface ModuleFs {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  /** Deletes a file (no error when it is missing). Needs `rw:`. */
  remove(path: string): Promise<void>;
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
}

/** Cross-module read: ctx.query("module.name", ...args). */
export type QueryFn = (name: string, ...args: unknown[]) => unknown | Promise<unknown>;

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
  /** Read-only. */
  prove(ctx: Pick<CommandCtx, "log" | "store" | "query">): Proof | Promise<Proof>;
}

export interface Proof {
  level: "ok" | "warn" | "error";
  text: string;
  evidence?: string;
  fix?: string;
}

/** What the host injects into the factory. */
export interface Sdk {
  version: 1;
  log: Logger;
  ui: SdkUi;
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

export interface FieldSpec {
  id: string;
  label: string;
  kind: "area" | "line" | "toggle";
  /** Rows of an `area` (default 5). */
  rows?: number;
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
  | string[]; // home.notes (home.panel's shape is decided with the widgets, Fase 3B)

export interface WidgetDef {
  slot: SlotId;
  /** Order inside the slot. */
  priority: number;
  refreshMs?: number;
  data(): SlotData | Promise<SlotData>;
}

// ---- sdk.ui: injected by the host, so a module never imports React ----

export type Tone = "ok" | "warn" | "error" | "info" | "accent" | "dim" | "text";
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

export interface SdkUi {
  /** JSX factory. A module file needs the classic-runtime pragmas (jsxRuntime classic, jsx h, jsxFrag Fragment), else Bun imports React. */
  h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  Fragment: unknown;
  useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  useRef<T>(init: T): { current: T };

  /** Bordered box with a title. */
  Panel: Component<Kids & { title?: string; tone?: Tone; grow?: boolean }>;
  /** Children side by side, equal widths. Give each Panel `grow` so their borders match in height. */
  Row: Component<Kids>;
  Text: Component<Kids & { tone?: Tone; bold?: boolean }>;
  Chip: Component<{ label: string; level?: Level }>;
  /** `value` 0..1; colored by level (above 85% error, above 70% warn). */
  Meter: Component<{ value: number; width?: number; label?: string }>;
  KeyHint: Component<{ keys: string; label: string }>;
  Table: Component<{ columns: string[]; rows: string[][] }>;
  /** Display list; `selected` is an item id. `mark` is a short colored prefix (an unread dot). */
  List: Component<{ items: { id: string; label: string; detail?: string; tone?: Tone; mark?: { text: string; tone: Tone } }[]; selected?: string }>;
  /** Form of one of the module's commands (generated from its ArgSpec). enter runs it; esc cancels. */
  Form: Component<{ command: string; onRun?: (result: CommandRun) => void; onCancel?: () => void }>;
  Spacer: Component<{ size?: number }>;
  /**
   * An editable form: `area` (multiline), `line` (one line) and `toggle` (space marks) fields. It owns the keyboard
   * while mounted: tab/shift+tab move between fields, ctrl+s calls `onSubmit` with every value, esc calls `onCancel`.
   */
  Fields: Component<{
    fields: FieldSpec[];
    initial?: Record<string, string | boolean>;
    onSubmit: (values: Record<string, string | boolean>) => void;
    onCancel: () => void;
  }>;

  /** Runs `line` (a command of this module) through the session: it lands in the scrollback and the history. */
  useCommand(line: string): { run(opts?: { args?: string[]; stdin?: string }): Promise<CommandRun>; running: boolean; lastResult?: CommandRun };
  /** Calls `ctx.query`-style: `useQuery("module.name", ...args)`. Re-runs when name or args change. */
  useQuery<T = unknown>(name: string, ...args: unknown[]): { data?: T; error?: string; loading: boolean };
  /** This module's own store (one state.json). */
  useStore(): Store;
  /** Pages of this module only: `push("name")`, `pop()`. */
  useRouter(): { push(page: string): void; pop(): void };
  /**
   * Adds a key to the page while the calling component is mounted. Call it in render: `handler` closes over the
   * component state. The key joins the footer and `?`. Reserved (ignored): esc, ?, ctrl+c, ctrl+k.
   */
  useKey(keys: string, label: string, handler: () => void, opts?: { help?: boolean }): void;
  /** Shows the host's short notice ("nada aqui") for a key that has no effect. */
  useNudge(): (msg?: string) => void;
  /** The host's conformity cache (profile results and plan). Read-only: it never runs by itself; call `refresh()`. */
  useConformity(): Conformity;
  /** Terminal size in cells: a page has no scroll, so a long list windows itself by it. */
  useViewport(): { cols: number; rows: number };
  /** Color tokens (`c`) and glyphs (`g`) of the active theme. */
  useTheme(): { c: Readonly<Record<string, string>>; g: Readonly<Record<string, string>> };
}
