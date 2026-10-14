// Runs a module's REAL factory on a fake machine, for the tests that go through the host (`runSession`, `renderPage`): the loader
// imports the module as always, and every `exec`, `shell`, `fs` and `isRoot` its commands, proofs, queries and widgets get comes from a `FakeSystem`.
import type { CapabilityDef, CommandCtx, CommandDef, ModuleDef, ModuleFactory, ModuleFs, ModuleQuery, ReadCtx, WidgetDef } from "@pvx/sdk";
import { createReadShell, createShell } from "@pvx/core";
import type { FakeSystem } from "./fake-system.ts";

export interface FakeMachineOptions {
  /** Paths that stay real and go to the host's own `ctx.fs` (the module's state dir under the temp `PVX_HOME`), so a test can read what the module wrote there. */
  real?: (path: string) => boolean;
}

type ReadFs = Pick<ModuleFs, "read" | "exists" | "list">;

const readFsOf = (system: FakeSystem, real: ReadFs, isReal: (path: string) => boolean): ReadFs => ({
  read: (path) => (isReal(path) ? real.read(path) : system.fs.read(path)),
  exists: (path) => (isReal(path) ? real.exists(path) : system.fs.exists(path)),
  list: (path) => system.fs.list(path),
});

const commandFsOf = (system: FakeSystem, real: ModuleFs, isReal: (path: string) => boolean): ModuleFs => ({
  ...readFsOf(system, real, isReal),
  write: (path, data, opts) => (isReal(path) ? real.write(path, data, opts) : system.fs.write(path, data, opts)),
  remove: (path) => (isReal(path) ? real.remove(path) : system.fs.remove(path)),
  append: (path, text) => (isReal(path) ? real.append(path, text) : system.fs.append(path, text)),
});

function commandOnMachine(ctx: CommandCtx, system: FakeSystem, isReal: (path: string) => boolean): CommandCtx {
  const shell = createShell(system.exec, { jobLog: ctx.jobLog, signal: ctx.signal });
  return { ...ctx, exec: system.exec, shell, isRoot: system.isRoot, fs: commandFsOf(system, ctx.fs, isReal) };
}

function readOnMachine(ctx: ReadCtx, system: FakeSystem, isReal: (path: string) => boolean): ReadCtx {
  return { ...ctx, exec: system.exec, shell: createReadShell(system.exec), isRoot: system.isRoot, fs: readFsOf(system, ctx.fs, isReal) };
}

function commandsOnMachine(commands: Record<string, CommandDef>, system: FakeSystem, isReal: (path: string) => boolean): Record<string, CommandDef> {
  const wrap = (command: CommandDef): CommandDef => ({ ...command, run: (ctx) => command.run(commandOnMachine(ctx, system, isReal)) });
  return Object.fromEntries(Object.entries(commands).map(([name, command]) => [name, wrap(command)]));
}

/** A query runs with `this` set to the `ReadCtx`, so the wrapper keeps `function` and swaps `this`. */
function queriesOnMachine(queries: Record<string, ModuleQuery>, system: FakeSystem, isReal: (path: string) => boolean): Record<string, ModuleQuery> {
  const wrap = (query: ModuleQuery): ModuleQuery =>
    function (this: ReadCtx, ...args: Parameters<ModuleQuery>) {
      return query.apply(readOnMachine(this, system, isReal), args);
    };
  return Object.fromEntries(Object.entries(queries).map(([name, query]) => [name, wrap(query)]));
}

const capabilityOnMachine = (capability: CapabilityDef, system: FakeSystem, isReal: (path: string) => boolean): CapabilityDef => ({
  ...capability,
  prove: (ctx) => capability.prove(readOnMachine(ctx, system, isReal)),
});

const widgetOnMachine = (widget: WidgetDef, system: FakeSystem, isReal: (path: string) => boolean): WidgetDef => ({
  ...widget,
  data: (ctx) => widget.data(readOnMachine(ctx, system, isReal)),
});

function widgetsOnMachine(widgets: Record<string, WidgetDef>, system: FakeSystem, isReal: (path: string) => boolean): Record<string, WidgetDef> {
  return Object.fromEntries(Object.entries(widgets).map(([name, widget]) => [name, widgetOnMachine(widget, system, isReal)]));
}

/**
 * The module's real factory, with its commands, proofs, queries and widgets seeing `system` instead of the machine: fake `exec` and
 * `shell`, fake `fs` (except the `real` paths) and `ctx.isRoot` from `system.isRoot`. Export the result from the fixture module's entry:
 * `export default onFakeMachine(factory, system)`.
 */
export function onFakeMachine(factory: ModuleFactory, system: FakeSystem, options: FakeMachineOptions = {}): ModuleFactory {
  const isReal = options.real ?? (() => false);
  return (sdk) => {
    const module: ModuleDef = factory(sdk);
    return {
      ...module,
      commands: commandsOnMachine(module.commands ?? {}, system, isReal),
      queries: queriesOnMachine(module.queries ?? {}, system, isReal),
      capabilities: module.capabilities?.map((capability) => capabilityOnMachine(capability, system, isReal)),
      widgets: widgetsOnMachine(module.widgets ?? {}, system, isReal),
    };
  };
}
