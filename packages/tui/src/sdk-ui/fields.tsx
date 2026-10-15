import { useContext, useEffect, useRef, useState } from "react";
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import type { Component, SdkUi } from "@pvx/sdk";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { matchKey } from "../keymap.ts";
import { LineText } from "../LineText.tsx";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import { END_OF_TEXT, withDerived } from "./derive.ts";
import { HostCtx } from "./host.tsx";

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
/** Under a required field left empty. */
const REQUIRED_MESSAGE = "preencha este campo";
/** The marker of a required field: one asterisk after the label, in the error colour. */
const REQUIRED_MARK = " *";
/** Columns of the focus marker (`›`) before every row: the marker takes its own column, so labels and inputs never move when the focus does. */
const MARK_W = 2;
/** The width of every input cell: fixed, so the cells line up. */
const INPUT_W = 30;
const MIN_INPUT_W = 12;
/** What the page and the form spend around the fields: the page padding. */
const PAGE_PADDING = 2;
/** Columns between an input cell and its hint. */
const HINT_GAP = 2;
/** Narrowest hint worth drawing. */
const MIN_HINT_W = 10;

/** `text` cut to `width` cells with an ellipsis; empty when there is no room for a useful hint. */
function fitHint(text: string, width: number): string {
  if (width < MIN_HINT_W) return "";
  const cells = [...text];
  return cells.length <= width ? text : `${cells.slice(0, width - 1).join("")}…`;
}
const TEXT_KINDS: readonly string[] = ["line", "secret", "area"];

/** Blank rows between two fields. */
const FIELD_GAP = 1;

type Field = Props["fields"][number];

const fieldId = (field: Field): string => `field-${field.id}`;

/** The label cell of a field: its label and, when required, the mark. */
const labelCell = (field: Field): string => clean(field.label) + (field.required ? REQUIRED_MARK : "");

/** The required fields of a text kind that have nothing typed (`values` as `read` builds them). */
function requiredProblems(fields: Field[], values: Record<string, Value>): Record<string, string> {
  const empty = fields.filter((field) => field.required && TEXT_KINDS.includes(field.kind) && String(values[field.id] ?? "").trim() === "");
  return Object.fromEntries(empty.map((field) => [field.id, REQUIRED_MESSAGE]));
}

const picks0 = (f: { id: string; options?: { value: string }[] }, initial: Record<string, string | boolean>) => String(initial[f.id] ?? f.options?.[0]?.value ?? "");

/** The keyboard of the form. Mounted one commit after the form: handlers run newest first, so it outranks the page and the tab bar. */
function Keys({ on }: { on: (k: Parameters<Parameters<typeof useKeys>[0]>[0]) => void }) {
  useKeys((k) => {
    if (matchKey(k, "ctrl+k")) return; // the palette is the host's
    on(k);
    return true; // the form owns every other key; a focused textarea still gets its own
  });
  return null;
}

export const Fields: Component<Props> = (props) => {
  const { fields, initial = {}, onSubmit, onCancel, onDelete, deleteLabel = "remover", deleteConfirm, validate, active = true, buttons: showButtons = true, onEdge, title, description, submitLabel = "salvar", details } = props;
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const host = useContext(HostCtx); // a form outside a page (the Módulos tab) has no page footer: its screen sets the scope
  const [focus, setFocus] = useState(0);
  const [ready, setReady] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Record<string, Line>>(() => Object.fromEntries(fields.filter((f) => f.kind === "line" || f.kind === "secret").map((f) => [f.id, f.derive ? { text: String(initial[f.id] ?? ""), cursor: END_OF_TEXT } : lineOf(String(initial[f.id] ?? ""))])));
  const [touched, setTouched] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.filter((f) => f.derive && initial[f.id]).map((f) => [f.id, true]))); // a given initial value is the technician's
  const [marks, setMarks] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.filter((f) => f.kind === "toggle").map((f) => [f.id, initial[f.id] === true])));
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(fields.filter((f) => f.kind === "choice").map((f) => [f.id, String(initial[f.id] ?? f.options?.[0]?.value ?? "")])));
  const [checks, setChecks] = useState<Record<string, string[]>>(() => Object.fromEntries(fields.filter((f) => f.kind === "multi").map((f) => [f.id, String(initial[f.id] ?? "").split(",").filter(Boolean)])));
  const [cursors, setCursors] = useState<Record<string, number>>(() => Object.fromEntries(fields.filter((f) => f.kind === "choice" || f.kind === "multi").map((f) => [f.id, f.kind === "choice" ? Math.max(0, f.options?.findIndex((o) => o.value === picks0(f, initial)) ?? 0) : 0])));
  const [shown, setShown] = useState<string | undefined>(undefined); // a revealed or generated secret stays readable while its field has the focus
  const [detailsOpen, setDetailsOpen] = useState(false);
  const areas = useRef<Record<string, TextareaRenderable | null>>({});
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    const at = fields[focus];
    if (at) scroll.current?.scrollChildIntoView(fieldId(at));
  }, [focus]);

  const buttons: Button[] = showButtons ? ["save", "cancel", ...(onDelete ? (["remove"] as const) : [])] : [];
  const total = fields.length + buttons.length;
  const here = fields[focus]; // undefined: a button has the focus
  const button = focus >= fields.length ? buttons[focus - fields.length] : undefined;

  // Footer rows for this form; ctrl+s and the arrows are handled by the form itself, these only show.
  const listy = here?.kind === "choice" || here?.kind === "multi";
  const enterHint = button ? "ativa" : here?.kind === "toggle" ? "marca" : here?.kind === "choice" ? "escolhe" : here?.kind === "area" ? "" : focus === fields.length - 1 ? "salva" : "avança";
  const marks_ = fields.some((f) => f.kind === "toggle" || f.kind === "multi" || f.kind === "choice");
  const hints = [
    here?.kind === "area" ? "tab|campo" : listy ? "↑↓|opção\ntab|campo" : "↑↓ tab|campo",
    marks_ ? `space|${here?.kind === "choice" ? "escolhe" : "marca"}` : "",
    here?.kind === "secret" && here.generate ? `${here.generate}|gera` : "",
    here?.kind === "secret" ? "ctrl+r|mostra ou oculta|help" : "",
    enterHint && `enter|${enterHint}`,
    "ctrl+s|salva",
    details ? "ctrl+d|ver o comando" : "",
  ].filter(Boolean).join("\n");
  useEffect(() => {
    if (!active || !host) return;
    const offs = hints.split("\n").map((hint) => {
      const [keys, label, help] = hint.split("|");
      return host.addKey({ keys: keys!, label: label!, help: help === "help", run() {} });
    });
    return () => offs.forEach((off) => off());
  }, [host, hints, active]);

  /** The values of the form, the lines as given (`from`; the derived fields are filled in by `shownLines`). */
  const valuesOf = (from: Record<string, Line>, over: Record<string, Value> = {}): Record<string, Value> => ({
    ...Object.fromEntries(fields.filter((f) => f.kind === "area").map((f) => [f.id, areas.current[f.id]?.plainText ?? ""])),
    ...Object.fromEntries(Object.entries(from).map(([id, l]) => [id, l.text])),
    ...picks,
    ...Object.fromEntries(fields.filter((f) => f.kind === "multi").map((f) => [f.id, (f.options ?? []).filter((o) => checks[f.id]!.includes(o.value)).map((o) => o.value).join(",")])),
    ...marks,
    ...over,
  });
  const shownLines = withDerived(fields, lines, touched, (from) => valuesOf(from));
  const read = (over: Record<string, Value> = {}): Record<string, Value> => valuesOf(shownLines, over);
  const go = (n: number) => (setFocus(n), setConfirm(false), setShown(undefined));
  /** `over`: values the state has not caught up with yet (a choice picked by the same enter). */
  const submit = (over?: Record<string, Value>) => {
    const values = read(over);
    const found = { ...requiredProblems(fields, values), ...(validate?.(values) ?? {}) };
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
  const remove = () => void onDelete?.();
  /** In a page the host asks in its dialog; a form outside a page (no session) asks on its own last line. */
  const askDelete = () => {
    const session = host?.deps?.session; // a bare host (a test double) has none
    if (!session) return setConfirm(true);
    const question = { title: `${deleteLabel}?`, confirmLabel: deleteLabel, destructive: true, ...deleteConfirm };
    void session.confirm(question).then((yes) => yes && remove());
  };
  const press = (b: Button) => (b === "save" ? submit() : b === "cancel" ? onCancel() : askDelete());

  const onKey: Parameters<typeof Keys>[0]["on"] = (k) => {
    if (confirm) {
      if (k.name === "escape") setConfirm(false);
      else if (matchKey(k, "enter")) remove();
      return;
    }
    if (k.name === "escape") return onCancel();
    if (matchKey(k, "ctrl+s")) return submit();
    const typing = here !== undefined && TEXT_KINDS.includes(here.kind); // `?` is a character there
    if (details && (matchKey(k, "ctrl+d") || (k.sequence === "?" && !typing))) return setDetailsOpen(!detailsOpen);
    if (here?.kind === "secret" && matchKey(k, "ctrl+r")) return setShown(shown === here.id ? undefined : here.id);
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
      const e = editLine(shownLines[here.id]!, k);
      if (!e) return;
      const changed = e.text !== shownLines[here.id]!.text;
      setLines({ ...lines, [here.id]: { text: e.text, cursor: changed && e.text === "" ? END_OF_TEXT : e.cursor } });
      if (here.derive && changed) setTouched({ ...touched, [here.id]: e.text !== "" }); // empty: follows again
      if (changed) clear(here.id);
    }
  };

  const labelW = Math.max(0, ...fields.filter((f) => f.kind !== "area" && f.kind !== "choice" && f.kind !== "multi").map((f) => [...labelCell(f)].length));
  const stacked = labelW > LABEL_MAX;
  const labelCol = stacked ? 0 : labelW + 2;
  const col = MARK_W + labelCol; // where the input and the text under it start
  const inputW = Math.max(MIN_INPUT_W, Math.min(INPUT_W, cols - PAGE_PADDING - col));
  const hintW = cols - PAGE_PADDING - col - inputW - HINT_GAP;
  const err = (f: { id: string }) =>
    errors[f.id] ? (
      <text wrapMode="none" flexShrink={0} fg={c.error}>{`${" ".repeat(col)}${g.error} ${clean(errors[f.id]!)}`}</text>
    ) : null;
  /** The label of a field, with its required mark; it sits in a column beside the input, or above it when the labels are long. */
  const labelOf = (f: Field, on: boolean) => (
    <text wrapMode="none" flexShrink={0}>
      <span fg={on ? c.accent : c.text}>{clean(f.label)}</span>
      {f.required ? <span fg={c.error}>{REQUIRED_MARK}</span> : null}
    </text>
  );
  const focusMark = (on: boolean) => <box width={MARK_W} flexShrink={0}><text wrapMode="none" fg={c.accent}>{on ? g.query : " "}</text></box>;
  const labelColumn = (f: Field, on: boolean) => (stacked ? null : <box width={labelCol} flexShrink={0}>{labelOf(f, on)}</box>);
  /** The primary button is always filled (accent); the others are plain, filled with their tone on focus. A focused button is also underlined. */
  const btn = (b: Button, label: string) => {
    const on = button === b;
    if (b === "save") return btnBox(b, <text wrapMode="none" fg={c.bg} bg={c.accent}><b>{on ? <u>{`[ ${label} ]`}</u> : `[ ${label} ]`}</b></text>);
    const color = b === "remove" ? c.error : c.dim;
    return btnBox(b, <text wrapMode="none" fg={on ? c.bg : color} bg={on ? color : undefined}>{on ? <u>{`[ ${label} ]`}</u> : `[ ${label} ]`}</text>);
  };
  const btnBox = (b: Button, content: React.ReactNode) => (
    <box key={b} flexShrink={0} onMouseDown={() => (go(fields.length + buttons.indexOf(b)), press(b))}>{content}</box>
  );

  const textField = (f: Field, i: number, on: boolean) => (
    <box key={f.id} flexDirection="column" flexShrink={0} onMouseDown={() => go(i)}>
      {stacked ? <box flexDirection="row" flexShrink={0}>{focusMark(on)}{labelOf(f, on)}</box> : null}
      <box flexDirection="row" flexShrink={0}>
        {stacked ? <box width={MARK_W} flexShrink={0} /> : focusMark(on)}
        {labelColumn(f, on)}
        <box width={inputW} flexShrink={0} backgroundColor={on ? c.selected : c.panel}>
          <text wrapMode="none" flexShrink={0}>
            <LineText line={shownLines[f.id]!} focused={on} width={inputW} mask={f.kind === "secret" && shown !== f.id} pad />
          </text>
        </box>
        {f.help ? <text wrapMode="none" flexShrink={0} fg={c.dim}>{`${" ".repeat(HINT_GAP)}${fitHint(clean(f.help), hintW)}`}</text> : null}
      </box>
      {err(f)}
    </box>
  );
  const toggleField = (f: Field, i: number, on: boolean) => (
    <box key={f.id} flexDirection="column" flexShrink={0} onMouseDown={() => (go(i), flip(f.id))}>
      {stacked ? <box flexDirection="row" flexShrink={0}>{focusMark(on)}{labelOf(f, on)}</box> : null}
      <box flexDirection="row" flexShrink={0}>
        {stacked ? <box width={MARK_W} flexShrink={0} /> : focusMark(on)}
        {labelColumn(f, on)}
        <text wrapMode="none" flexShrink={0}>
          <span fg={on ? c.bg : c.text} bg={on ? c.accent : undefined}>{`[${marks[f.id] ? "x" : " "}]`}</span>
          <span fg={c.text}>{f.text ? ` ${clean(f.text)}` : ""}</span>
        </text>
      </box>
      {err(f)}
    </box>
  );
  const optionsField = (f: Field, i: number, on: boolean) => (
    <box key={f.id} flexDirection="column" flexShrink={0}>
      {f.label ? <box flexDirection="row" flexShrink={0}>{focusMark(on)}{labelOf(f, on)}</box> : null}
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
  const areaField = (f: Field, i: number, on: boolean) => (
    <box key={f.id} flexShrink={0} height={(f.rows ?? 5) + 2} border borderStyle="rounded" borderColor={on ? c.accent : c.border} title={clean(f.label)} onMouseDown={() => go(i)}>
      <textarea ref={(r: TextareaRenderable | null) => void (areas.current[f.id] = r)} focused={i === focus && active} initialValue={String(initial[f.id] ?? "")} flexGrow={1} />
    </box>
  );
  const fieldView = (f: Field, i: number) => {
    const on = i === focus && !confirm && active;
    if (f.kind === "area") return areaField(f, i, on);
    if (f.kind === "toggle") return toggleField(f, i, on);
    if (f.kind === "choice" || f.kind === "multi") return optionsField(f, i, on);
    return textField(f, i, on);
  };
  /** Rows a field takes now: its input (a label line above it when stacked), the hint or error under it, the options, the area. */
  const rowsOf = (f: Field): number => {
    if (f.kind === "area") return (f.rows ?? 5) + 2;
    const under = errors[f.id] ? 1 : 0;
    if (f.kind === "choice" || f.kind === "multi") return (f.label ? 1 : 0) + (f.options?.length ?? 0) + under;
    return 1 + (stacked ? 1 : 0) + under;
  };
  /** The height of the fields area when everything fits: the area shrinks and scrolls only when the terminal is shorter than this. */
  const areaRows = fields.reduce((sum, f, i) => sum + rowsOf(f) + (i === 0 ? 0 : FIELD_GAP), 0);
  /** One field with a blank row above it (never collapsed: a short terminal scrolls the area instead). */
  const spaced = (f: Field, i: number) => (
    <box key={f.id} id={fieldId(f)} flexShrink={0} marginTop={i === 0 ? 0 : FIELD_GAP}>
      {fieldView(f, i)}
    </box>
  );

  return (
    <box flexDirection="column" flexShrink={1} minHeight={0}>
      {ready && active ? <Keys on={onKey} /> : null}
      {title ? <text wrapMode="none" flexShrink={0} fg={c.text}><b>{clean(title)}</b></text> : null}
      {description ? <text wrapMode="none" flexShrink={0} fg={c.dim}>{clean(description)}</text> : null}
      {title ? <text flexShrink={0}> </text> : null}
      <scrollbox ref={scroll} flexShrink={1} minHeight={0} maxHeight={areaRows} focused={false}>
        {fields.map(spaced)}
      </scrollbox>
      {details && detailsOpen ? <text wrapMode="none" flexShrink={0} fg={c.dim}>{clean(details(read()))}</text> : null}
      {showButtons ? <text flexShrink={0}> </text> : null}
      {showButtons ? <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" flexShrink={0} gap={2}>
          {focusMark(button !== undefined)}
          {btn("save", clean(submitLabel))}
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
