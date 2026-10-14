import { fakeSystem, onFakeMachine } from "../../../src/index.ts";
import factory from "./real.ts";

/** The fake machine of the fixture: the test imports it to arm the rules and read what the module did. */
export const system = fakeSystem({ rules: [(call) => (call.cmd === "tool" ? { lines: [`tool ${call.args.join(" ")}`] } : undefined)], isRoot: false });

export default onFakeMachine(factory, system);
