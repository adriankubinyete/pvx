import { useState } from "react";
import { matchKey } from "../keymap.ts";
import { editLine } from "../lineedit.ts";
import { useScreenScope } from "../router.tsx";
import { useKeys } from "../keys.tsx";
import { Form } from "../palette/Form.tsx";
import { buildLine, type FormValues } from "../palette/form.ts";
import { useTheme } from "../theme-context.tsx";
import type { Item } from "./tree.ts";

/** Form of a command with args (the palette's `Form`, `buildLine` and secret rules). Owns only its own keys. */
export function MenuForm({ item, onRun, onBack }: { item: Item; onRun: (line: string, secrets: Record<string, string>) => void; onBack: () => void }) {
  const { c, box, g } = useTheme();
  const specs = item.args!;
  const [values, setValues] = useState<FormValues>({});
  const [focus, setFocusRaw] = useState(0);
  const [cursor, setCursor] = useState(Infinity); // code points; clamped, so a new field lands at the end
  const setFocus = (i: number) => (setFocusRaw(i), setCursor(Infinity));
  const [msg, setMsg] = useState("");
  const built = buildLine(item.line!, specs, values);
  useScreenScope("form", 1);
  const f = specs[focus]!;
  const edit = (v: string | boolean) => setValues({ ...values, [f.name]: v });
  useKeys((k) => {
    setMsg("");
    if (k.name === "escape") return onBack(), true;
    if (matchKey(k, "enter")) return built.missing.length ? setMsg(`falta: ${built.missing.join(", ")}`) : onRun(built.display, built.secrets), true;
    if (matchKey(k, "tab") || k.name === "down") return setFocus((focus + 1) % specs.length), true;
    if (k.name === "up") return setFocus((focus + specs.length - 1) % specs.length), true;
    if (f.kind === "flag") return k.sequence === " " ? (edit(values[f.name] !== true), true) : undefined;
    const text = String(values[f.name] ?? "");
    const r = editLine({ text, cursor: Math.min(cursor, [...text].length) }, k);
    if (!r) return;
    if (!r.exit) edit(r.text), setCursor(r.cursor);
    return true;
  });
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} ${item.line}`}>
      <text fg={c.dim}>{` ${item.help}`}</text>
      <Form specs={specs} values={values} focus={focus} cursor={cursor} line={built} />
      <text fg={c.warn}>{msg}</text>
    </box>
  );
}
