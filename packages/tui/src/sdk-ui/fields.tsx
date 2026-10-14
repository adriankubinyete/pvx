import { useEffect, useRef, useState } from "react";
import type { TextareaRenderable } from "@opentui/core";
import type { Component, SdkUi } from "@pvx/sdk";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { matchKey } from "../keymap.ts";
import { LineText } from "../LineText.tsx";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import { useHost } from "./host.tsx";

type Props = Parameters<SdkUi["Fields"]>[0];
type Value = string | boolean;
type Button = "save" | "cancel" | "remove";

/** Labels wider than this stack above their input instead of taking a column. */
const LABEL_MAX = 26;

/** The keyboard of the form. Mounted one commit after the form: handlers run newest first, so it outranks the page and the tab bar. */
function Keys({ on }: { on: (k: Parameters<Parameters<typeof useKeys>[0]>[0]) => void }) {
  useKeys((k) => (on(k), true)); // the form owns every key; a focused textarea still gets its own
  return null;
}

export const Fields: Component<Props> = (props) => {
  const { fields, initial = {}, onSubmit, onCancel, onDelete, deleteLabel = "remover", validate } = props;
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const host = useHost();
  const [focus, setFocus] = useState(0);
  const [ready, setReady] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Record<string, Line>>(() => Object.fromEntries(fields.filter((f) => f.kind === "line").map((f) => [f.id, lineOf(String(initial[f.id] ?? ""))])));
  const [marks, setMarks] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.filter((f) => f.kind === "toggle").map((f) => [f.id, initial[f.id] === true])));
  const areas = useRef<Record<string, TextareaRenderable | null>>({});
  useEffect(() => setReady(true), []);

  const buttons: Button[] = ["save", "cancel", ...(onDelete ? (["remove"] as const) : [])];
  const total = fields.length + buttons.length;
  const here = fields[focus]; // undefined: a button has the focus
  const button = focus >= fields.length ? buttons[focus - fields.length] : undefined;

  // Footer rows for this form; ctrl+s and the arrows are handled by the form itself, these only show.
  const enterHint = button ? "ativa" : here?.kind === "toggle" ? "marca" : here?.kind === "area" ? "" : focus === fields.length - 1 ? "salva" : "avança";
  const hints = [here?.kind === "area" ? "tab|campo" : "↑↓ tab|campo", fields.some((f) => f.kind === "toggle") ? "space|marca" : "", enterHint && `enter|${enterHint}`, "ctrl+s|salva"].filter(Boolean).join("\n");
  useEffect(() => {
    const offs = hints.split("\n").map((h) => host.addKey({ keys: h.split("|")[0]!, label: h.split("|")[1]!, run() {} }));
    return () => offs.forEach((off) => off());
  }, [host, hints]);

  const read = (): Record<string, Value> => ({
    ...Object.fromEntries(fields.filter((f) => f.kind === "area").map((f) => [f.id, areas.current[f.id]?.plainText ?? ""])),
    ...Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, l.text])),
    ...marks,
  });
  const go = (n: number) => (setFocus(n), setConfirm(false));
  const submit = () => {
    const found = validate?.(read()) ?? {};
    setErrors(found);
    const bad = fields.findIndex((f) => found[f.id]);
    if (bad >= 0) return go(bad);
    onSubmit(read());
  };
  const flip = (id: string) => (setMarks({ ...marks, [id]: !marks[id] }), setErrors({ ...errors, [id]: "" }));
  const press = (b: Button) => (b === "save" ? submit() : b === "cancel" ? onCancel() : setConfirm(true));
  const remove = () => void onDelete?.();

  const onKey: Parameters<typeof Keys>[0]["on"] = (k) => {
    if (confirm) {
      if (k.name === "escape") setConfirm(false);
      else if (matchKey(k, "enter")) remove();
      return;
    }
    if (k.name === "escape") return onCancel();
    if (matchKey(k, "ctrl+s")) return submit();
    const step = (d: number) => go((focus + d + total) % total);
    if (matchKey(k, "tab")) return step(1);
    if (matchKey(k, "shift+tab")) return step(-1);
    if (here?.kind === "area") return; // the textarea owns arrows and enter
    if (matchKey(k, "up")) return step(-1);
    if (matchKey(k, "down")) return step(1);
    if (button) {
      if (matchKey(k, "left")) return go(Math.max(fields.length, focus - 1));
      if (matchKey(k, "right")) return go(Math.min(total - 1, focus + 1));
      if (matchKey(k, "enter") || k.sequence === " ") return press(button);
      return;
    }
    if (here?.kind === "toggle") {
      if (matchKey(k, "enter") || k.sequence === " ") flip(here.id);
      return;
    }
    if (here?.kind === "line") {
      if (matchKey(k, "enter")) return focus === fields.length - 1 ? submit() : step(1);
      const e = editLine(lines[here.id]!, k);
      if (!e) return;
      setLines({ ...lines, [here.id]: { text: e.text, cursor: e.cursor } });
      if (e.text !== lines[here.id]!.text && errors[here.id]) setErrors({ ...errors, [here.id]: "" });
    }
  };

  const labelW = Math.max(0, ...fields.filter((f) => f.kind !== "area").map((f) => [...clean(f.label)].length));
  const stacked = labelW > LABEL_MAX;
  const col = stacked ? 0 : labelW + 2;
  const inputW = Math.max(12, Math.min(60, cols - 8 - col - 2));
  const bar = g.hline === "─" ? "┃" : "|";
  const err = (f: { id: string }) =>
    errors[f.id] ? (
      <text wrapMode="none" flexShrink={0} fg={c.error}>{`${" ".repeat(stacked ? 2 : col)}${g.warn} ${clean(errors[f.id]!)}`}</text>
    ) : null;
  const btn = (b: Button, label: string) => {
    const on = button === b;
    const tone = b === "remove" ? c.error : c.accent;
    return (
      <box key={b} flexShrink={0} onMouseDown={() => (go(fields.length + buttons.indexOf(b)), press(b))}>
        <text wrapMode="none" fg={on ? c.bg : b === "remove" ? c.error : c.text} bg={on ? tone : undefined}>{`[ ${label} ]`}</text>
      </box>
    );
  };

  return (
    <box flexDirection="column" flexShrink={0}>
      {ready ? <Keys on={onKey} /> : null}
      {fields.map((f, i) => {
        const on = i === focus && !confirm;
        const label = clean(f.label);
        if (f.kind === "area")
          return (
            <box key={f.id} flexShrink={0} height={(f.rows ?? 5) + 2} border borderStyle="rounded" borderColor={on ? c.accent : c.border} title={label} onMouseDown={() => go(i)}>
              <textarea ref={(r: TextareaRenderable | null) => void (areas.current[f.id] = r)} focused={i === focus} initialValue={String(initial[f.id] ?? "")} flexGrow={1} />
            </box>
          );
        const head = <span fg={on ? c.accent : c.dim}>{stacked ? "" : label.padEnd(labelW + 2)}</span>;
        if (f.kind === "toggle")
          return (
            <box key={f.id} flexDirection="column" flexShrink={0} onMouseDown={() => (go(i), flip(f.id))}>
              {stacked ? <text wrapMode="none" fg={on ? c.accent : c.dim}>{label}</text> : null}
              <text wrapMode="none" flexShrink={0}>
                {head}
                <span fg={on ? c.bg : c.text} bg={on ? c.accent : undefined}>{`[${marks[f.id] ? "x" : " "}]`}</span>
                <span fg={c.text}>{f.text ? ` ${clean(f.text)}` : ""}</span>
              </text>
              {err(f)}
            </box>
          );
        return (
          <box key={f.id} flexDirection="column" flexShrink={0} onMouseDown={() => go(i)}>
            {stacked ? <text wrapMode="none" fg={on ? c.accent : c.dim}>{label}</text> : null}
            <text wrapMode="none" flexShrink={0}>
              {head}
              <span fg={errors[f.id] ? c.error : on ? c.accent : c.dim}>{`${bar}`}</span>
              <LineText line={lines[f.id]!} focused={on} width={inputW} />
            </text>
            {err(f)}
          </box>
        );
      })}
      <text flexShrink={0}> </text>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" flexShrink={0} gap={2}>
          {btn("save", "salvar")}
          {btn("cancel", "cancelar")}
        </box>
        {onDelete ? btn("remove", clean(deleteLabel)) : null}
      </box>
      {confirm ? (
        <box flexShrink={0} onMouseDown={remove}>
          <text wrapMode="none" fg={c.error}>{`${clean(deleteLabel)}? enter confirma · esc volta`}</text>
        </box>
      ) : null}
    </box>
  );
};
