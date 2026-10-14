import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Logger, SlotData, WidgetDef } from "@pvx/sdk";
import { execute } from "../../src/engine/execute.ts";
import { loadModules } from "../../src/engine/loader.ts";
import { createRegistry } from "../../src/engine/registry.ts";
import { createSlotHub } from "../../src/engine/slots.ts";

const logs: string[] = [];
const log: Logger = { debug() {}, info() {}, warn() {}, error: (m) => void logs.push(m) };
const makeLogger = () => log;
const chip = (label: string, priority: number, extra: Partial<WidgetDef> = {}): WidgetDef => ({
  slot: "home.chips", priority, data: () => [{ label, level: "ok" }], ...extra,
});

describe("SlotHub", () => {
  test("orders items by priority, host first; nothing is read before it is collected", async () => {
    const hub = createSlotHub();
    hub.add("m", "b", chip("b", 2));
    hub.add("m", "a", chip("a", 1));
    expect(hub.read("home.chips")).toBeUndefined();
    hub.setHost("home.chips", [{ label: "host", level: "ok" }]);
    await hub.refresh();
    expect((hub.read("home.chips") as { label: string }[]).map((c) => c.label)).toEqual(["host", "a", "b"]);
    hub.add("m", "s1", { slot: "home.summary", priority: 2, data: () => "dois" });
    hub.add("m", "s2", { slot: "home.summary", priority: 1, data: () => "um" });
    await hub.refresh();
    expect(hub.read("home.summary")).toBe("um · dois");
  });

  test("a widget that throws, times out or returns the wrong shape is removed, logged, and the others stay", async () => {
    logs.length = 0;
    const hub = createSlotHub({ timeoutMs: 30 });
    hub.add("m", "ok", chip("ok", 1));
    hub.add("m", "boom", chip("x", 2, { data: () => { throw new Error("bum"); } }));
    hub.add("m", "hang", chip("x", 3, { data: () => new Promise<SlotData>(() => {}) }));
    hub.add("m", "shape", chip("x", 4, { data: () => "texto" }));
    const stop = hub.start(log);
    await Bun.sleep(100);
    stop();
    expect(hub.broken("home.chips")).toEqual(["m.boom", "m.hang", "m.shape"]);
    expect(hub.read("home.chips")).toEqual([{ label: "ok", level: "ok" }]);
    expect(logs.some((l) => l.includes("m.boom") && l.includes("bum"))).toBe(true);
    expect(logs.some((l) => l.includes("m.hang"))).toBe(true);
  });

  test("refreshMs: one scheduler batches the due widgets in one notification; the floor applies", async () => {
    let a = 0, b = 0, once = 0, notified = 0;
    const hub = createSlotHub({ minRefreshMs: 20 });
    hub.add("m", "a", chip("a", 1, { refreshMs: 30, data: () => (a++, []) }));
    hub.add("m", "b", chip("b", 2, { refreshMs: 1, data: () => (b++, []) })); // below the floor: 20 ms
    hub.add("m", "once", chip("once", 3, { data: () => (once++, []) }));
    hub.subscribe(() => notified++);
    const stop = hub.start(log);
    await Bun.sleep(200);
    stop();
    const [ca, cb] = [a, b];
    await Bun.sleep(80);
    expect([a, b]).toEqual([ca, cb]); // stopped: nothing runs
    expect(once).toBe(1);
    expect(a).toBeGreaterThanOrEqual(3);
    expect(b).toBeGreaterThan(a);
    expect(notified).toBeLessThan(a + b); // batched: fewer notifications than collections
  });
});

describe("widgets in modules", () => {
  test("loader collects them; ctx.slots.read returns the last data without re-evaluating", async () => {
    process.env.PVX_USERMODULES = join(import.meta.dir, "../fixtures/usermodules");
    const registry = createRegistry({ slots: { timeoutMs: 30 } });
    await loadModules(registry, { hostVersion: "1.0.0", makeLogger });
    const read = async () => (await execute(registry, "widget-demo read home.chips", { makeLogger })).lines[0]!.text;
    expect(await read()).toBe("null"); // not collected yet
    await registry.slots.refresh();
    expect(JSON.parse(await read())).toEqual([{ label: "demo", level: "ok", detail: "tudo certo" }]);
    expect(registry.slots.broken("home.chips")).toEqual(["widget-demo.boom"]);
    expect(registry.slots.broken("home.attention")).toEqual(["widget-demo.hang"]);
  });
});

describe("SlotHub hidden modules", () => {
  test("read and broken skip the widgets of a hidden module; hasWidgets says who contributed", async () => {
    const hub = createSlotHub({ timeoutMs: 30 });
    hub.add("a", "x", chip("a", 1));
    hub.add("b", "x", chip("b", 2));
    hub.add("b", "boom", chip("x", 3, { data: () => { throw new Error("bum"); } }));
    hub.setHost("home.chips", [{ label: "host", level: "ok" }]);
    const stop = hub.start(log);
    await Bun.sleep(60);
    stop();
    const labels = (hidden?: Set<string>) => (hub.read("home.chips", hidden) as { label: string }[]).map((c) => c.label);
    expect(labels()).toEqual(["host", "a", "b"]);
    expect(labels(new Set(["b"]))).toEqual(["host", "a"]); // the host's own data stays
    expect(hub.broken("home.chips")).toEqual(["b.boom"]);
    expect(hub.broken("home.chips", new Set(["b"]))).toEqual([]);
    expect(hub.hasWidgets("a")).toBe(true);
    expect(hub.hasWidgets("none")).toBe(false);
  });
});
