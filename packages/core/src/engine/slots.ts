import type { Logger, SlotData, SlotId, WidgetDef } from "@pvx/sdk";

export interface SlotOpts {
  /** A widget `data()` slower than this is removed. */
  timeoutMs?: number;
  /** Floor for `refreshMs`. */
  minRefreshMs?: number;
}

interface Entry {
  id: string;
  def: WidgetDef;
  data?: SlotData;
  /** Why it was removed from its slot. */
  broken?: string;
  running: boolean;
  /** When it is due next (Infinity: never again). */
  next: number;
}

const isList = (slot: SlotId) => slot !== "home.summary";
/** Home slots have fixed shapes: anything else is a broken widget. */
const validShape = (slot: SlotId, d: unknown) => (slot === "home.panel" ? true : isList(slot) ? Array.isArray(d) : typeof d === "string");

export interface SlotHub {
  /** Called by the registry for each widget of a module. */
  add(moduleId: string, name: string, def: WidgetDef): void;
  /** Data the host itself contributes to a slot (first in it). Does not notify. */
  setHost(slot: SlotId, data: SlotData | undefined): void;
  /** Last data of a slot: host first, then widgets by priority. Never evaluates. Summaries are joined with " · ". */
  read(slot: SlotId): SlotData | undefined;
  /** Ids ("module.widget") of the widgets of this slot that were removed. */
  broken(slot: SlotId): string[];
  subscribe(fn: () => void): () => void;
  /** Starts the single scheduler (collects now, then by `refreshMs`). Returns stop. Only the TUI calls it. */
  start(log: Logger): () => void;
  /** Re-collects every live widget now. */
  refresh(): Promise<void>;
}

export function createSlotHub(opts: SlotOpts = {}): SlotHub {
  const { timeoutMs = 2000, minRefreshMs = 1000 } = opts;
  const entries: Entry[] = [];
  const host = new Map<SlotId, SlotData>();
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());
  let log: Logger | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  async function collect(e: Entry) {
    e.running = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      const d = await Promise.race([
        Promise.resolve().then(() => e.def.data()),
        new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`passou de ${timeoutMs} ms`)), timeoutMs))),
      ]);
      if (!validShape(e.def.slot, d)) throw new Error(`formato inválido para ${e.def.slot}`);
      e.data = d;
      e.next = e.def.refreshMs ? Date.now() + Math.max(minRefreshMs, e.def.refreshMs) : Infinity;
    } catch (err) {
      e.broken = (err as Error).message ?? String(err);
      e.data = undefined;
      e.next = Infinity;
      try {
        log?.error(`widget ${e.id} quebrou: ${e.broken}`);
      } catch {}
    } finally {
      clearTimeout(t);
      e.running = false;
    }
  }

  const live = () => entries.filter((e) => !e.broken);
  async function batch(due: Entry[]) {
    await Promise.all(due.map(collect));
    if (running) notify();
  }
  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    const next = Math.min(...live().map((e) => e.next));
    if (next === Infinity) return;
    timer = setTimeout(async () => {
      await batch(live().filter((e) => !e.running && e.next <= Date.now()));
      schedule();
    }, Math.max(0, next - Date.now()));
  }

  return {
    add: (moduleId, name, def) => void entries.push({ id: `${moduleId}.${name}`, def, running: false, next: 0 }),
    setHost: (slot, data) => void (data === undefined ? host.delete(slot) : host.set(slot, data)),
    read(slot) {
      const own = entries.filter((e) => e.def.slot === slot && e.data !== undefined).sort((a, b) => a.def.priority - b.def.priority);
      const h = host.get(slot);
      if (!isList(slot)) {
        const all = [h, ...own.map((e) => e.data)].filter((s): s is string => typeof s === "string" && s !== "");
        return all.length ? all.join(" · ") : undefined;
      }
      return h === undefined && !own.length ? undefined : ([h, ...own.map((e) => e.data)].filter(Array.isArray).flat() as SlotData);
    },
    broken: (slot) => entries.filter((e) => e.def.slot === slot && e.broken).map((e) => e.id),
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    start(l) {
      log = l;
      running = true;
      void batch(live().filter((e) => !e.running)).then(schedule);
      return () => ((running = false), clearTimeout(timer));
    },
    async refresh() {
      await batch(live().filter((e) => !e.running));
      schedule();
    },
  };
}
