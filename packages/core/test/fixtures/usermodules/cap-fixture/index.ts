import type { CapabilityDef, ModuleFactory } from "@pvx/sdk";

const pending = (id: string, fix: string): CapabilityDef => ({
  id,
  title: id,
  goal: "g",
  fix,
  prove: () => ({ level: "error", text: "pendente" }),
});

const factory: ModuleFactory = () => ({
  commands: {
    "fix-a": { help: "Fixes a", run: (ctx) => ctx.out.success("a aplicado") },
    "fix-b": { help: "Fails", run: (ctx) => ctx.out.error("b falhou") },
    "fix-c": { help: "Fixes c", run: (ctx) => ctx.out.success("c aplicado") },
  },
  capabilities: [
    { id: "cap-fixture.fine", title: "fine", goal: "g", prove: () => ({ level: "ok", text: "em ordem" }) },
    pending("cap-fixture.a", "cap-fixture fix-a"),
    pending("cap-fixture.b", "cap-fixture fix-b"),
    pending("cap-fixture.c", "cap-fixture fix-c"),
    { id: "cap-fixture.manual", title: "manual", goal: "g", prove: () => ({ level: "warn", text: "sem fix" }) },
  ],
});
export default factory;
