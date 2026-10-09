import type { ArgSpec } from "@pvx/sdk";
import { useTheme } from "../theme-context.tsx";
import { clean } from "./search.ts";
import type { BuiltLine, FormValues } from "./form.ts";

export interface FormProps {
  specs: ArgSpec[];
  values: FormValues;
  /** Index of the field being edited; -1 when the form is not focused. */
  focus: number;
  line: BuiltLine;
  /** Last run of this command, if known. */
  last?: string;
}

/** Form generated from `ArgSpec`. Display only: the palette owns the keys. Secrets are masked and never reach the CLI line. */
export function Form({ specs, values, focus, line, last }: FormProps) {
  const { c, g } = useTheme();
  return (
    <box flexDirection="column" flexShrink={0}>
      {specs.map((s, i) => {
        const v = values[s.name];
        const on = i === focus;
        const shown = s.kind === "flag" ? (v === true ? "[x]" : "[ ]") : s.secret ? g.active.repeat(String(v ?? "").length) : String(v ?? "");
        return (
          <text key={s.name}>
            <span fg={on ? c.accent : c.dim}>{on ? g.cursor : " "} </span>
            <span fg={c.text}>{s.name}</span>
            <span fg={c.warn}>{s.required ? "*" : " "}</span>
            <span fg={c.accent}>{` ${clean(shown)}${on && s.kind !== "flag" ? "_" : ""}`}</span>
            <span fg={c.dim}>{`  ${clean(s.help)}${s.secret ? " (segredo)" : ""}`}</span>
          </text>
        );
      })}
      <text fg={c.accent}>{`$ pvx ${clean(line.display)}`}</text>
      {Object.keys(line.secrets).length ? <text fg={c.dim}>{`segredo fora da linha: ${Object.keys(line.secrets).join(", ")}`}</text> : null}
      {last ? <text fg={c.dim}>{`última: ${clean(last)}`}</text> : null}
    </box>
  );
}
