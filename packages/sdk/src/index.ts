/** SDK v1: the public module contract. Types only, plus EXIT. */

export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, NOT_FOUND: 3 } as const;

export interface Manifest {
  id: string;
  version: string;
  entry: string;
  /** Host semver range. */
  pvx?: string;
  applies?: { file?: string };
  permissions?: { exec?: string[]; net?: string[]; fs?: string[] };
  contributes?: { commands?: string[]; pages?: string[]; widgets?: string[]; capabilities?: string[] };
  /** Modules this one queries via ctx.query. */
  uses?: string[];
}

export type ModuleFactory = (sdk: Sdk) => ModuleDef;

export interface ModuleDef {
  /** Key = command path with spaces: "ip trust-phonevox". */
  commands?: Record<string, CommandDef>;
  capabilities?: CapabilityDef[];
  queries?: Record<string, QueryFn>;
  /** Key = page name; opened by `#<module>.<name>` (or `#<name>` when unique). */
  pages?: Record<string, PageDef>;
  widgets?: Record<string, WidgetDef>;
}

export interface CommandDef {
  help: string;
  args?: ArgSpec[];
  /** Marked with ! and confirmed in the plan. */
  destructive?: boolean;
  /** Name of one of this module's pages: opened after the command runs ok. */
  page?: string;
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
}

export interface CommandCtx {
  args: Record<string, string | boolean | undefined>;
  out: Out;
  log: Logger;
  store: Store;
  query: QueryFn;
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
}

export interface KeySpec {
  /** `a`, `space`, `enter`, `ctrl+x`, `L`. */
  keys: string;
  label: string;
  run(): void;
}

export type Level = "ok" | "warn" | "error";

/** Home slots (Fase 3B fills them). The data shape of each slot is fixed by the core. */
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
export type Component<P> = (props: P) => unknown;

export interface CommandRun {
  exit: number;
  lines: OutLine[];
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
  Panel: Component<Kids & { title?: string; tone?: Tone }>;
  Text: Component<Kids & { tone?: Tone; bold?: boolean }>;
  Chip: Component<{ label: string; level?: Level }>;
  /** `value` 0..1; colored by level (above 85% error, above 70% warn). */
  Meter: Component<{ value: number; width?: number; label?: string }>;
  KeyHint: Component<{ keys: string; label: string }>;
  Table: Component<{ columns: string[]; rows: string[][] }>;
  /** Display list; `selected` is an item id. */
  List: Component<{ items: { id: string; label: string; detail?: string; tone?: Tone }[]; selected?: string }>;
  /** Form of one of the module's commands (generated from its ArgSpec). enter runs it; esc cancels. */
  Form: Component<{ command: string; onRun?: (result: CommandRun) => void; onCancel?: () => void }>;
  Spacer: Component<{ size?: number }>;

  /** Runs `line` (a command of this module) through the session: it lands in the scrollback and the history. */
  useCommand(line: string): { run(): Promise<CommandRun>; running: boolean; lastResult?: CommandRun };
  /** Calls `ctx.query`-style: `useQuery("module.name", ...args)`. Re-runs when name or args change. */
  useQuery<T = unknown>(name: string, ...args: unknown[]): { data?: T; error?: string; loading: boolean };
  /** This module's own store (one state.json). */
  useStore(): Store;
  /** Pages of this module only: `push("name")`, `pop()`. */
  useRouter(): { push(page: string): void; pop(): void };
  /** Color tokens (`c`) and glyphs (`g`) of the active theme. */
  useTheme(): { c: Readonly<Record<string, string>>; g: Readonly<Record<string, string>> };
}
