// What a form says to the technician: labels, help and the field specs of a command's arguments. Pure.
import type { ArgSpec, FieldSpec } from "@pvx/sdk";
import { clean } from "../palette/search.ts";

/** `id-cliente` becomes `Id cliente`: the fallback when an argument has no `label`. */
export function humanize(name: string): string {
  const spaced = name.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A parenthesis that talks about how the CLI receives the value, not about the value. */
const CLI_PARENTHESIS = /\s*\([^)]*(?:stdin|PVX_SECRET|prompt|segredo)[^)]*\)/gi;

/** The help of an argument for the form: the CLI plumbing (stdin, `PVX_SECRET_*`, prompt, "(segredo)") cut out. */
export function helpOf(help: string): string {
  return clean(help).replace(CLI_PARENTHESIS, "").trim();
}

/** The label a form shows for an argument. */
export const labelOf = (arg: ArgSpec): string => clean(arg.label ?? humanize(arg.name));

function kindOf(arg: ArgSpec): FieldSpec["kind"] {
  if (arg.kind === "flag") return "toggle";
  return arg.secret ? "secret" : "line";
}

/** The field of one argument: a flag is a checkbox with its help beside it, the rest a line (a secret when `secret`). */
export function fieldOf(arg: ArgSpec): FieldSpec {
  const kind = kindOf(arg);
  const field: FieldSpec = { id: arg.name, label: labelOf(arg), kind, required: arg.required };
  if (kind === "toggle") return { ...field, text: helpOf(arg.help) };
  return { ...field, help: helpOf(arg.help) };
}

/** `derive` by argument name makes that field follow the others (`FieldSpec.derive`). */
export function fieldsOfArgs(args: ArgSpec[], derive: Record<string, NonNullable<FieldSpec["derive"]>> = {}): FieldSpec[] {
  return args.map((arg) => {
    const field = fieldOf(arg);
    return derive[arg.name] && field.kind === "line" ? { ...field, derive: derive[arg.name] } : field;
  });
}
