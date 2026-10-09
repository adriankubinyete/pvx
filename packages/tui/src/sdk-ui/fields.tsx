import { useEffect, useRef, useState } from "react";
import type { TextareaRenderable } from "@opentui/core";
import type { Component, SdkUi } from "@pvx/sdk";
import { useKeys } from "../keys.tsx";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { matchKey } from "../keymap.ts";
import { LineText } from "../LineText.tsx";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import { useHost } from "./host.tsx";

type Props = Parameters<SdkUi["Fields"]>[0];
type Value = string | boolean;

/** The keyboard of the form. Mounted one commit after the form: handlers run newest first, so it outranks the page and the tab bar. */
function Keys({ props, focus, setFocus, read, edit }: { props: Props; focus: number; setFocus: (n: number) => void; read: () => Record<string, Value>; edit: (k: Parameters<typeof editLine>[1]) => void }) {
  const { fields, onSubmit, onCancel } = props;
  useKeys((k) => {
    if (k.name === "escape") return onCancel(), true;
    if (matchKey(k, "ctrl+s")) return onSubmit(read()), true;
    if (matchKey(k, "tab") || matchKey(k, "shift+tab")) return setFocus((focus + (k.shift ? fields.length - 1 : 1)) % fields.length), true;
    edit(k);
    return true; // the form owns every key; a focused textarea still gets its own
  });
  return null;
}

export const Fields: Component<Props> = (props) => {
  const { fields, initial = {} } = props;
  const { c, g, box } = useTheme();
  const host = useHost();
  const [focus, setFocus] = useState(0);
  const [ready, setReady] = useState(false);
  const [lines, setLines] = useState<Record<string, Line>>(() => Object.fromEntries(fields.filter((f) => f.kind === "line").map((f) => [f.id, lineOf(String(initial[f.id] ?? ""))])));
  const [marks, setMarks] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.filter((f) => f.kind === "toggle").map((f) => [f.id, initial[f.id] === true])));
  const areas = useRef<Record<string, TextareaRenderable | null>>({});
  useEffect(() => setReady(true), []);
  useEffect(() => host.addKey({ keys: "ctrl+s", label: "salva", run() {} }), [host]); // shown in the footer; the form handles the key itself

  const read = () => ({
    ...Object.fromEntries(fields.filter((f) => f.kind === "area").map((f) => [f.id, areas.current[f.id]?.plainText ?? ""])),
    ...Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, l.text])),
    ...marks,
  });
  const edit = (k: Parameters<typeof editLine>[1]) => {
    const f = fields[focus];
    if (f?.kind === "line") {
      const e = editLine(lines[f.id]!, k);
      if (e) setLines({ ...lines, [f.id]: { text: e.text, cursor: e.cursor } });
    } else if (f?.kind === "toggle" && k.sequence === " ") setMarks({ ...marks, [f.id]: !marks[f.id] });
  };

  return (
    <box flexDirection="column" flexShrink={0}>
      {ready ? <Keys props={props} focus={focus} setFocus={setFocus} read={read} edit={edit} /> : null}
      {fields.map((f, i) => {
        const on = i === focus;
        const label = clean(f.label);
        if (f.kind === "area")
          return (
            <box key={f.id} flexShrink={0} height={(f.rows ?? 5) + 2} {...box(on ? c.accent : undefined)} title={label}>
              <textarea ref={(r: TextareaRenderable | null) => void (areas.current[f.id] = r)} focused={on} initialValue={String(initial[f.id] ?? "")} flexGrow={1} />
            </box>
          );
        if (f.kind === "toggle")
          return (
            <text key={f.id} wrapMode="none" flexShrink={0}>
              <span fg={on ? c.accent : c.dim}>{on ? `${g.cursor} ` : "  "}</span>
              <span fg={c.text}>{`[${marks[f.id] ? "x" : " "}] ${label}`}</span>
            </text>
          );
        return (
          <text key={f.id} wrapMode="none" flexShrink={0}>
            <span fg={on ? c.accent : c.dim}>{on ? `${g.cursor} ` : "  "}</span>
            <span fg={c.dim}>{`${label}: `}</span>
            <LineText line={lines[f.id]!} focused={on} width={40} />
          </text>
        );
      })}
    </box>
  );
};
