import type { BuiltinModule } from "@pvx/sdk";
import conformidade from "./conformidade/src/index.tsx";
import conformidadeManifest from "./conformidade/pvx-module.json";
import motd from "./motd/src/index.ts";
import motdManifest from "./motd/pvx-module.json";
import notas from "./notas/src/index.tsx";
import notasManifest from "./notas/pvx-module.json";

/**
 * The modules that ship with pvx. A static list, because a compiled binary cannot `import()` a path chosen at run time.
 * The host knows no module id: this barrel is the only place that names them. Each one is written like a usermodule.
 */
export const builtin: readonly BuiltinModule[] = [
  { manifest: conformidadeManifest, factory: conformidade },
  { manifest: notasManifest, factory: notas },
  { manifest: motdManifest, factory: motd },
];
