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

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** 24 letters and digits from the OS random source (rejection sampling: no modulo bias). */
export function generateSecret(n = 24): string {
  let out = "";
  while (out.length < n) for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 248 && out.length < n) out += ALNUM[b % 62];
  return out;
}

/** Labels wider than this stack above their input instead of taking a column. */
const LABEL_MAX = 26;

const picks0 = (f: { id: string; options?: { value: string }[] }, initial: Record<string, string | boolean>) => String(initial[f.id] ?? f.options?.[0]?.value ?? "");

/** The keyboard of the form. Mounted one commit after the form: handlers run newest first, so it outranks the page and the tab bar. */
function Keys({ on }: { on: (k: Parameters<Parameters<typeof useKeys>[0]>[0]) => void }) {
  useKeys((k) => (on(k), true)); // the form owns every key; a focused textarea still gets its own
  return null;
}

export const Fields: Component<Props> = (props) => {
  const { fields, initial = {}, onSubmit, onCancel, onDelete, deleteLabel = "remover", validate, active = true, buttons: showButtons = true, onEdge } = props;
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const host = useHost();
  const [focus, setFocus] = useState(0);
  const [ready, setReady] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Record<string, Line>>(() => Object.fromEntries(fields.filter((f) => f.kind === "line" || f.kind === "secret").map((f) => [f.id, lineOf(String(initial[f.id] ?? ""))])));
  const [marks, setMarks] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.filter((f) => f.kind === "toggle").map((f) => [f.id, initial[f.id] === true])));
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(fields.filter((f) => f.kind === "choice").map((f) => [f.id, String(initial[f.id] ?? f.options?.[0]?.value ?? "")])));
  const [checks, setChecks] = useState<Record<string, string[]>>(() => Object.fromEntries(fields.filter((f) => f.kind === "multi").map((f) => [f.id, String(initial[f.id] ?? "").split(",").filter(Boolean)])));
  const [cursors, setCursors] = useState<Record<string, number>>(() => Object.fromEntries(fields.filter((f) => f.kind === "choice" || f.kind === "multi").map((f) => [f.id, f.kind === "choice" ? Math.max(0, f.options?.findIndex((o) => o.value === picks0(f, initial)) ?? 0) : 0])));
  const [shown, setShown] = useState<string | undefined>(undefined); // a generated secret stays readable while its field has the focus
  const areas = useRef<Record<string, TextareaRenderable | null>>({});
  useEffect(() => setReady(true), []);

  const buttons: Button[] = showButtons ? ["save", "cancel", ...(onDelete ? (["remove"] as const) : [])] : [];
  const total = fields.length + buttons.length;
  const here = fields[focus]; // undefined: a button has the focus
  const button = focus >= fields.length ? buttons[focus - fields.length] : undefined;

  // Footer rows for this form; ctrl+s and the arrows are handled by the form itself, these only show.
  const listy = here?.kind === "choice" || here?.kind === "multi";
  const enterHint = button ? "ativa" : here?.kind === "toggle" ? "marca" : here?.kind === "choice" ? "escolhe" : here?.kind === "area" ? "" : focus === fields.length - 1 ? "salva" : "avança";
  const marks_ = fields.some((f) => f.kind === "toggle" || f.kind === "multi" || f.kind === "choice");
  const hints = [here?.kind === "area" ? "tab|campo" : listy ? "↑↓|opção\ntab|campo" : "↑↓ tab|campo", marks_ ? `space|${here?.kind === "choice" ? "escolhe" : "marca"}` : "", here?.kind === "secret" && here.generate ? `${here.generate}|gera` : "", enterHint && `enter|${enterHint}`, "ctrl+s|salva"].filter(Boolean).join("\n");
  useEffect(() => {
    if (!active) return;
    const offs = hints.split("\n").map((h) => host.addKey({ keys: h.split("|")[0]!, label: h.split("|")[1]!, run() {} }));
    return () => offs.forEach((off) => off());
  }, [host, hints, active]);

  const read = (over: Record<string, Value> = {}): Record<string, Value> => ({
    ...Object.fromEntries(fields.filter((f) => f.kind === "area").map((f) => [f.id, areas.current[f.id]?.plainText ?? ""])),
    ...Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, l.text])),
    ...picks,
    ...Object.fromEntries(fields.filter((f) => f.kind === "multi").map((f) => [f.id, (f.options ?? []).filter((o) => checks[f.id]!.includes(o.value)).map((o) => o.value).join(",")])),
    ...marks,
    ...over,
  });
  const go = (n: number) => (setFocus(n), setConfirm(false), setShown(undefined));
  /** `over`: values the state has not caught up with yet (a choice picked by the same enter). */
  const submit = (over?: Record<string, Value>) => {
    const found = validate?.(read(over)) ?? {};
    setErrors(found);
    const bad = fields.findIndex((f) => found[f.id]);
    if (bad >= 0) return go(bad);
    onSubmit(read(over));
  };
  const flip = (id: string) => (setMarks({ ...marks, [id]: !marks[id] }), setErrors({ ...errors, [id]: "" }));
  const clear = (id: string) => errors[id] && setErrors({ ...errors, [id]: "" });
  const pick = (f: (typeof fields)[number], at: number) => {
    const v = f.options?.[at]?.value;
    if (v === undefined) return;
    setCursors({ ...cursors, [f.id]: at });
    if (f.kind === "choice") setPicks({ ...picks, [f.id]: v });
    else setChecks({ ...checks, [f.id]: checks[f.id]!.includes(v) ? checks[f.id]!.filter((x) => x !== v) : [...checks[f.id]!, v] });
    clear(f.id);
  };
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
    // An arrow past the first or last stop hands the key to `onEdge` (when given) instead of wrapping; tab always wraps.
    const step = (d: number, arrow = false) => {
      const n = focus + d;
      if (arrow && onEdge && (n < 0 || n >= total)) return onEdge(d < 0 ? "up" : "down");
      go((n + total) % total);
    };
    if (matchKey(k, "tab")) return step(1);
    if (matchKey(k, "shift+tab")) return step(-1);
    if (here?.kind === "area") return; // the textarea owns arrows and enter
    if (here && (here.kind === "choice" || here.kind === "multi")) {
      const at = cursors[here.id] ?? 0;
      const n = here.options?.length ?? 0;
      if (matchKey(k, "up")) return at > 0 ? setCursors({ ...cursors, [here.id]: at - 1 }) : step(-1, true); // the edges hand the arrow to the next field
      if (matchKey(k, "down")) return at < n - 1 ? setCursors({ ...cursors, [here.id]: at + 1 }) : step(1, true);
      if (k.sequence === " ") return pick(here, at);
      if (matchKey(k, "enter")) {
        if (here.kind === "choice") pick(here, at);
        const picked = here.kind === "choice" && here.options?.[at] ? { [here.id]: here.options[at]!.value } : undefined;
        return focus === fields.length - 1 ? submit(picked) : step(1);
      }
      return;
    }
    if (matchKey(k, "up")) return step(-1, true);
    if (matchKey(k, "down")) return step(1, true);
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
    if (here?.kind === "line" || here?.kind === "secret") {
      if (matchKey(k, "enter")) return focus === fields.length - 1 ? submit() : step(1);
      if (here.kind === "secret" && here.generate && matchKey(k, here.generate)) {
        const text = generateSecret();
        setLines({ ...lines, [here.id]: lineOf(text) });
        setShown(here.id);
        return clear(here.id);
      }
      const e = editLine(lines[here.id]!, k);
      if (!e) return;
      setLines({ ...lines, [here.id]: { text: e.text, cursor: e.cursor } });
      if (e.text !== lines[here.id]!.text) clear(here.id);
    }
  };

  const labelW = Math.max(0, ...fields.filter((f) => f.kind !== "area" && f.kind !== "choice" && f.kind !== "multi").map((f) => [...clean(f.label)].length));
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
      {ready && active ? <Keys on={onKey} /> : null}
      {fields.map((f, i) => {
        const on = i === focus && !confirm && active;
        const label = clean(f.label);
        if (f.kind === "area")
          return (
            <box key={f.id} flexShrink={0} height={(f.rows ?? 5) + 2} border borderStyle="rounded" borderColor={on ? c.accent : c.border} title={label} onMouseDown={() => go(i)}>
              <textarea ref={(r: TextareaRenderable | null) => void (areas.current[f.id] = r)} focused={i === focus && active} initialValue={String(initial[f.id] ?? "")} flexGrow={1} />
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
        if (f.kind === "choice" || f.kind === "multi")
          return (
            <box key={f.id} flexDirection="column" flexShrink={0}>
              {label ? <text wrapMode="none" fg={on ? c.accent : c.dim}>{label}</text> : null}
              {(f.options ?? []).map((o, oi) => {
                const here_ = on && cursors[f.id] === oi;
                const set = f.kind === "choice" ? picks[f.id] === o.value : checks[f.id]!.includes(o.value);
                const mark = f.kind === "choice" ? (set ? `(${g.active})` : "( )") : set ? "[x]" : "[ ]";
                return (
                  <box key={o.value} flexShrink={0} onMouseDown={() => (go(i), pick(f, oi))}>
                    <text wrapMode="none" flexShrink={0}>
                      <span fg={here_ ? c.accent : c.dim}>{here_ ? `${g.cursor} ` : "  "}</span>
                      <span fg={here_ ? c.bg : set ? c.accent : c.text} bg={here_ ? c.accent : undefined}>{mark}</span>
                      <span fg={c.text}>{` ${clean(o.label)}`}</span>
                      <span fg={c.dim}>{o.detail ? `  ${clean(o.detail)}` : ""}</span>
                    </text>
                  </box>
                );
              })}
              {err(f)}
            </box>
          );
        return (
          <box key={f.id} flexDirection="column" flexShrink={0} onMouseDown={() => go(i)}>
            {stacked ? <text wrapMode="none" fg={on ? c.accent : c.dim}>{label}</text> : null}
            <text wrapMode="none" flexShrink={0}>
              {head}
              <span fg={errors[f.id] ? c.error : on ? c.accent : c.dim}>{`${bar}`}</span>
              <LineText line={lines[f.id]!} focused={on} width={inputW} mask={f.kind === "secret" && shown !== f.id} />
            </text>
            {err(f)}
          </box>
        );
      })}
      {showButtons ? <text flexShrink={0}> </text> : null}
      {showButtons ? <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" flexShrink={0} gap={2}>
          {btn("save", "salvar")}
          {btn("cancel", "cancelar")}
        </box>
        {onDelete ? btn("remove", clean(deleteLabel)) : null}
      </box> : null}
      {confirm ? (
        <box flexShrink={0} onMouseDown={remove}>
          <text wrapMode="none" fg={c.error}>{`${clean(deleteLabel)}? enter confirma · esc volta`}</text>
        </box>
      ) : null}
    </box>
  );
};
