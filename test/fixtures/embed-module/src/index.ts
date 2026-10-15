import type { ModuleFactory } from "@pvx/sdk";
import { GREETING } from "./greeting.ts";

// A module for the build tests: it only imports types from the SDK and a relative file, like every module.
const factory: ModuleFactory = () => ({
  commands: {
    ping: { help: "Answers from the embedded copy", readonly: true, run: (ctx) => ctx.out.success(GREETING) },
  },
});

export default factory;
