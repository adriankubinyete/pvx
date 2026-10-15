import { useMemo, type ReactNode } from "react";
import type { ArgSpec } from "@pvx/sdk";
import { buildLine } from "../palette/form.ts";
import { Fields } from "./fields.tsx";
import { fieldsOfArgs } from "./labels.ts";

export interface CommandFormProps {
  /** The command's registry key (`<module> <words>`). */
  line: string;
  args: ArgSpec[];
  /** The header line, written once. */
  title: string;
  /** One dim line under the title. */
  description?: string;
  /** Label of the primary button (default "executar"). */
  submitLabel?: string;
  /** Fields that follow the others, by argument name. */
  derive?: Record<string, (values: Record<string, string | boolean>) => string>;
  /** The line to run (secrets are never in it) and the secrets by argument name. */
  onRun: (line: string, secrets: Record<string, string>) => void;
  onCancel: () => void;
}

/** `Component` returns `unknown`, which JSX rejects. */
const FieldsView = Fields as (props: Parameters<typeof Fields>[0]) => ReactNode;

const DEFAULT_SUBMIT_LABEL = "executar";

/** The form of a command with args: `Fields` with the labels, marks and help of its `ArgSpec`s. The CLI line shows only behind `ctrl+d`. */
export function CommandForm({ line, args, title, description, submitLabel = DEFAULT_SUBMIT_LABEL, derive, onRun, onCancel }: CommandFormProps) {
  const fields = useMemo(() => fieldsOfArgs(args, derive), [args, derive]);
  const run = (values: Record<string, string | boolean>) => {
    const built = buildLine(line, args, values);
    onRun(built.display, built.secrets);
  };
  const preview = (values: Record<string, string | boolean>) => `$ pvx ${buildLine(line, args, values).display}`;
  return <FieldsView title={title} description={description} fields={fields} submitLabel={submitLabel} onSubmit={run} onCancel={onCancel} details={preview} />;
}
