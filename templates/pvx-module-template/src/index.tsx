// The factory only builds the object: no I/O, network or exec here. This file only wires the parts.
import type { ModuleFactory } from "@pvx/sdk";
import { greetCommands } from "./commands/saudacao.ts";
import { capabilities } from "./health/prove.ts";
import { page } from "./page/index.tsx";
import { TEXT } from "./texts.ts";

export const factory: ModuleFactory = (sdk) => ({
  commands: { ...greetCommands },
  capabilities: capabilities(sdk.proof),
  pages: { painel: { title: TEXT.pageTitle, render: page(sdk) } },
});
export default factory;
