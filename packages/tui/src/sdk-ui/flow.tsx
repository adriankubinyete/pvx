import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Component, FieldSpec, Question, SdkUi, Tone } from "@pvx/sdk";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { matchKey } from "../keymap.ts";
import { useNudge } from "../nudge.tsx";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import type { Tokens } from "../theme.ts";
import { toneColor as tone } from "./tones.ts";
import { Fields } from "./fields.tsx";
import { FocusCtx, useHost } from "./host.tsx";
import { Button } from "./button.tsx";
import { BACKGROUND_NUDGE, DEFAULT_BUSY_LABEL, useBusy } from "./busy.ts";
import { useSpin } from "./spin.ts";
import { CLOCK_W, clock, fixedClock } from "./kit.tsx";

export { Button, unreachableButtons } from "./button.tsx";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;
type Value = string | boolean;

const len = (s: string) => [...s].length;

/** The width of a box, once laid out (`undefined` before): spread `props` on the box. */
function useWidth() {
  const box = useRef<{ width: number } | null>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  return [{ ref: box, onSizeChange: () => box.current && setWidth(box.current.width) }, width] as const;
}

/** Adds a footer/`?` row while mounted (no handler: the caller's key code runs the action). */
function useHints(hints: string, on = true) {
  const host = useHost();
  useEffect(() => {
    if (!on || !hints) return;
    const offs = hints.split("\n").map((h) => host.addKey({ keys: h.split("|")[0]!, label: h.split("|")[1]!, run() {} }));
    return () => offs.forEach((off) => off());
  }, [host, hints, on]);
}

// ---- Loading ----

export function Loading({ label }: Props<"Loading">) {
  const { c } = useTheme();
  const frame = useSpin(true);
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={c.info}>{`${frame} `}</span>
      <span fg={c.dim}>{clean(label)}</span>
    </text>
  );
}

/** Runs `fn` on mount and whenever `deps` change; `run()` repeats it. The last data stays while it re-runs; only the newest call lands. */
export function useAsync<T>(fn: () => T | Promise<T>, deps: readonly unknown[]): { loading: boolean; data?: T; error?: string; run(): Promise<void> } {
  const [st, setSt] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: true });
  const latest = useRef(fn);
  latest.current = fn;
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setSt((s) => ({ data: s.data, loading: true }));
    try {
      const data = await latest.current();
      if (id === seq.current) setSt({ data, loading: false });
    } catch (e) {
      if (id === seq.current) setSt((s) => ({ data: s.data, loading: false, error: (e as Error).message }));
    }
  }, []);
  useEffect(() => {
    void run();
    return () => void seq.current++; // a result that arrives after a re-run or the unmount is dropped
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...st, run };
}

// ---- ProgressBar ----

interface TimesInput {
  state: "running" | "failed" | "done";
  elapsed?: number;
  total?: number;
}

/** The color of the percentage and times of a bar: running is plain text, failed is the error color, done is the success color (never the accent). */
const PROGRESS_COLOR: Record<TimesInput["state"], (c: Tokens) => string> = { running: (c) => c.text, failed: (c) => c.error, done: (c) => c.ok };

/** The words after the percentage: times when `startedAt` is known, else just the state word for failed and done. */
function timesText({ state, elapsed, total }: TimesInput): string {
  if (elapsed === undefined) return { running: "", failed: "falhou", done: "concluído" }[state];
  if (state === "failed") return `falhou em ${clock(elapsed)}`; // a final time does not change: no padding
  if (state === "done") return `concluído em ${clock(elapsed)}`;
  if (total === undefined) return fixedClock(elapsed);
  return `${fixedClock(elapsed)} · faltam ~${clock(Math.max(0, total - elapsed)).padEnd(CLOCK_W)}`; // the time left is the last thing on the line: it pads on the right
}

export function ProgressBar({ value, startedAt, etaMs, state = "running", label }: Props<"ProgressBar">) {
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const [measure, width] = useWidth();
  const [now, setNow] = useState(() => Date.now());
  const [stopped, setStopped] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (state !== "running") return setStopped((s) => s ?? Date.now());
    setStopped(undefined);
    if (startedAt === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state, startedAt]);
  const v = state === "done" ? 1 : Math.max(0, Math.min(1, value));
  const elapsed = startedAt === undefined ? undefined : Math.max(0, (stopped ?? Math.max(now, startedAt)) - startedAt);
  // `etaMs` is the expected TOTAL duration; without it the pace so far gives one (after 5%, before that a guess is noise).
  const total = etaMs ?? (elapsed !== undefined && v >= 0.05 ? elapsed / v : undefined);
  const times = timesText({ state, elapsed, total });
  const tail = `${String(Math.round(v * 100)).padStart(3)}%${times ? `  ${times}` : ""}`;
  const head = label ? `${clean(label)} ` : "";
  const w = Math.max(4, (width ?? cols - 4) - len(head) - len(tail) - 1);
  const filled = Math.round(v * w);
  // A failure paints the cells at the stop point red, right after the filled part: one bar, no gap.
  const bad = state === "failed" ? Math.min(w - Math.min(filled, w - 1), Math.max(1, Math.round(w * 0.04))) : 0;
  const lit = state === "failed" ? Math.min(filled, w - bad) : filled;
  const color = PROGRESS_COLOR[state](c);
  return (
    <box width="100%" flexShrink={0} {...(measure as object)}>
      <text wrapMode="none" flexShrink={0}>
        {head ? <span fg={c.dim}>{head}</span> : null}
        <span fg={state === "done" ? c.ok : c.accent}>{g.progressFull.repeat(lit)}</span>
        {bad ? <span fg={c.error}>{g.progressFull.repeat(bad)}</span> : null}
        <span fg={c.dim}>{g.progressEmpty.repeat(Math.max(0, w - lit - bad))}</span>
        <span fg={color}>{` ${tail}`}</span>
      </text>
    </box>
  );
}

// ---- CellGrid ----

const CELL_WORD = { done: "concluído", running: "rodando", failed: "falhou", pending: "pendente" } as const;
const CELL_TONE: Record<keyof typeof CELL_WORD, Tone> = { done: "ok", running: "info", failed: "error", pending: "dim" };

/** The color of a cell: a pending one is the faint `border` token (the wall shows what is left as a shadow, the legend says the word). */
const cellColor = (c: Tokens, state: keyof typeof CELL_WORD): string => (state === "pending" ? c.border : tone(c, CELL_TONE[state]));

export function CellGrid({ cells, onPress, legend = true, focused }: Props<"CellGrid">) {
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const inPage = useContext(FocusCtx) ?? false;
  const on = focused ?? inPage;
  const [measure, width] = useWidth();
  const [sel, setSel] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<string | undefined>(undefined);
  const per = Math.max(1, Math.floor((width ?? cols - 6) / 2)); // a cell is its glyph and one space
  const at = Math.max(0, cells.findIndex((x) => x.id === sel));
  const selectCell = (index: number) => setSel(cells[index]!.id);
  /** Where each arrow goes from the selected cell; a target outside the grid means the key is not ours. */
  const target = { left: at - 1, right: at + 1, up: at - per, down: at + per };
  const arrowTarget = (key: Parameters<typeof matchKey>[0]) => {
    for (const [name, index] of Object.entries(target)) if (matchKey(key, name)) return index;
    return undefined;
  };
  useKeys((key) => {
    if (!on || !cells.length) return;
    if (matchKey(key, "enter") && onPress) {
      onPress(cells[at]!.id);
      return true;
    }
    // At an edge the key is not taken, so the page's own arrows (panel focus, back to the bar) still work.
    const index = arrowTarget(key);
    if (index === undefined || index < 0 || index >= cells.length) return;
    selectCell(index);
    return true;
  });
  const rows: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += per) rows.push(cells.slice(i, i + per));
  const count = (s: keyof typeof CELL_WORD) => cells.filter((x) => x.state === s).length;
  const here = cells.find((x) => x.id === (on ? cells[at]?.id : over));
  return (
    <box flexDirection="column" flexShrink={0} {...(measure as object)}>
      {legend ? (
        <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0}>
          {(Object.keys(CELL_WORD) as (keyof typeof CELL_WORD)[]).filter((s) => count(s)).map((s) => (
            <text key={s} wrapMode="none" flexShrink={0}>
              <span fg={cellColor(c, s)}>{`${s === "pending" ? g.cellOff : g.cellOn} `}</span>
              <span fg={c.dim}>{`${count(s)} ${CELL_WORD[s]}`}</span>
            </text>
          ))}
        </box>
      ) : null}
      {rows.map((row, y) => (
        <box key={y} flexDirection="row" flexShrink={0}>
          {row.map((cell) => {
            const lit = on && cells[at]?.id === cell.id;
            return (
              <box key={cell.id} width={2} flexShrink={0} backgroundColor={lit ? c.selected : cell.id === over ? c.panel : undefined}
                onMouseOver={() => (setOver(cell.id), on && setSel(cell.id))} onMouseOut={() => setOver((o) => (o === cell.id ? undefined : o))}
                onMouseDown={() => (setSel(cell.id), onPress?.(cell.id))}>
                <text wrapMode="none" fg={cellColor(c, cell.state)}>{`${cell.state === "pending" ? g.cellOff : g.cellOn} `}</text>
              </box>
            );
          })}
        </box>
      ))}
      <text wrapMode="none" flexShrink={0} fg={c.dim}>{here ? `${g.query} ${clean(here.label ?? here.id)}  ${CELL_WORD[here.state]}` : " "}</text>
    </box>
  );
}

// ---- Conversation ----

/** Pseudo-ids of the two buttons among the answered lines the cursor walks. */
const CONFIRM_STOP = "@ok";
const CANCEL_STOP = "@cancel";
const FieldsView = Fields as (p: Parameters<typeof Fields>[0]) => ReactNode;

/** What an answer reads like on its collapsed line. */
function summaryOf(q: Question, v: Value | undefined, dot: string): string {
  if (q.summary && v !== undefined) return clean(q.summary(v));
  const f = q.field;
  if (v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (f.kind === "secret") return dot.repeat(8);
  const label = (x: string) => f.options?.find((o) => o.value === x)?.label ?? x;
  if (f.kind === "choice") return clean(label(v));
  if (f.kind === "multi") return clean(v.split(",").filter(Boolean).map(label).join(", ") || "—");
  return clean(v.split("\n")[0]!);
}

export function Conversation({ questions, answers, onAnswer, onConfirm, header, footerSummary, confirmLabel = "confirmar", busyLabel = DEFAULT_BUSY_LABEL, onCancel }: Props<"Conversation">) {
  const { c, g } = useTheme();
  const host = useHost();
  const nudge = useNudge();
  const { busy, track } = useBusy();
  const spinner = useSpin(busy);
  const flow = questions.filter((q) => !q.skip);
  const [cur, setCur] = useState(0); // the flow question being asked; flow.length is the confirm step
  const [editing, setEditing] = useState<string | undefined>(undefined); // an answered question reopened in place
  const [cursor, setCursor] = useState<string | undefined>(() => (flow.length ? undefined : CONFIRM_STOP)); // list focus; undefined: the question has it
  const [touched, setTouched] = useState<string[]>([]);
  const [over, setOver] = useState<string | undefined>(undefined);
  const confirming = cur >= flow.length;
  const shown = confirming ? questions : flow.slice(0, cur);
  const stops = confirming ? [...questions.map((q) => q.id), CONFIRM_STOP, ...(onCancel ? [CANCEL_STOP] : [])] : shown.map((q) => q.id);
  const asking = editing === undefined && !confirming && cursor === undefined; // the current question owns the keyboard
  const leave = () => (onCancel ? onCancel() : host.pop());
  const confirm = () => {
    if (busy) return;
    track(onConfirm({ ...answers }));
  };
  /** While busy only `esc` works: it leaves and the command keeps running. */
  const leaveBusy = () => {
    nudge(BACKGROUND_NUDGE);
    leave();
  };

  const markTouched = (id: string) => setTouched((ids) => (ids.includes(id) ? ids : [...ids, id]));
  /** Back to where the user was: the confirm list row, or the open question. */
  const finishEdit = (id: string) => {
    setEditing(undefined);
    markTouched(id);
    setCursor(confirming ? id : undefined);
  };
  const advance = () => {
    const isLast = cur + 1 >= flow.length;
    if (!isLast) return setCur(cur + 1);
    setCur(flow.length);
    setCursor(CONFIRM_STOP);
  };
  const commit = (question: Question, value: Value | undefined) => {
    if (value !== undefined) onAnswer(question.id, value);
    if (editing === question.id) finishEdit(question.id);
    else advance();
  };
  const stopEdit = () => {
    setCursor(editing);
    setEditing(undefined);
  };
  const toQuestion = () => {
    setEditing(undefined);
    setCursor(confirming ? CONFIRM_STOP : undefined);
  };

  const listFocus = editing === undefined && cursor !== undefined;
  const moveCursor = (delta: -1 | 1) => {
    const next = stops[stops.indexOf(cursor!) + delta];
    if (next !== undefined) return setCursor(next);
    if (delta === 1 && !confirming) return setCursor(undefined); // past the last answered line: back to the question
    nudge();
  };
  const pressStop = () => {
    if (cursor === CONFIRM_STOP) return confirm();
    if (cursor === CANCEL_STOP) return leave();
    setEditing(cursor);
  };
  const listKeys: Record<string, () => void> = {
    up: () => moveCursor(-1),
    down: () => moveCursor(1),
    enter: pressStop,
    escape: () => (confirming ? leave() : setCursor(undefined)),
  };
  useKeys((key) => {
    if (busy) {
      if (matchKey(key, "esc")) leaveBusy();
      return true; // a busy flow takes every other key and ignores it
    }
    if (!listFocus) return;
    const name = Object.keys(listKeys).find((candidate) => matchKey(key, candidate === "escape" ? "esc" : candidate));
    if (!name) return;
    listKeys[name]!();
    return true;
  });
  const enterLabel: Record<string, string> = { [CONFIRM_STOP]: confirmLabel, [CANCEL_STOP]: "sai" };
  useHints(busy ? "esc|sai" : listFocus ? ["↑↓|resposta", `enter|${enterLabel[cursor!] ?? "edita"}`, `esc|${confirming ? "sai" : "pergunta"}`].join("\n") : "");

  const tw = Math.max(0, ...shown.map((q) => len(clean(q.title)))) + 3;
  const field = (q: Question): FieldSpec => ({ ...q.field, id: q.id, label: q.field.kind === "area" ? q.title : "" });
  const form = (q: Question, active: boolean, key: string) => (
    <box key={key} paddingLeft={3} flexShrink={0} onMouseDown={() => toQuestion()}>
      <FieldsView
        fields={[field(q)]} initial={answers[q.id] === undefined ? {} : { [q.id]: answers[q.id]! }} buttons={false} active={active}
        onSubmit={(v) => commit(q, v[q.id])}
        onCancel={() => (editing === q.id ? stopEdit() : active ? leave() : toQuestion())}
        onEdge={(dir) => (dir === "up" ? (shown.length ? setCursor(shown.at(-1)!.id) : nudge()) : nudge())}
      />
    </box>
  );
  const heading = (q: Question, mark: string) => (
    <text key={`h:${q.id}`} wrapMode="none" flexShrink={0}>
      <span fg={c.accent}><b>{`   ${mark} `}</b></span>
      <span fg={c.text}><b>{clean(q.title)}</b></span>
    </text>
  );
  const row = (q: Question) => {
    if (editing === q.id) return <box key={q.id} flexDirection="column" flexShrink={0}>{heading(q, "?")}{form(q, true, `e:${q.id}`)}</box>;
    const sel = listFocus && cursor === q.id;
    const hot = over === q.id && !sel;
    const dflt = confirming && q.skip && !touched.includes(q.id);
    return (
      <box key={q.id} flexShrink={0} backgroundColor={sel ? c.selected : hot ? c.panel : undefined}
        onMouseOver={() => (setOver(q.id), listFocus && setCursor(q.id))} onMouseOut={() => setOver((o) => (o === q.id ? undefined : o))}
        onMouseDown={() => (setCursor(undefined), setEditing(q.id))}>
        <text wrapMode="none">
          <span fg={sel ? c.accent : hot ? c.dim : c.ok}>{`   ${sel ? g.cursor : g.ok} `}</span>
          <span fg={c.dim}>{clean(q.title).padEnd(tw)}</span>
          <span fg={c.text}>{summaryOf(q, answers[q.id], g.active)}</span>
          <span fg={c.dim}>{dflt ? "  (padrão)" : ""}</span>
        </text>
      </box>
    );
  };
  const current = confirming ? undefined : flow[cur];
  const next = confirming ? undefined : flow[cur + 1];
  return (
    <box flexDirection="column" flexShrink={0}>
      {header as ReactNode}
      {shown.map(row)}
      {current ? <box flexDirection="column" flexShrink={0}>{heading(current, "?")}{form(current, asking, `q:${current.id}`)}</box> : null}
      {next ? <text wrapMode="none" fg={c.dim} flexShrink={0}>{`   ${g.inactive} ${clean(next.title)}`}</text> : null}
      {confirming ? (
        <box flexDirection="column" flexShrink={0}>
          {footerSummary ? <box flexDirection="column" flexShrink={0} paddingTop={1}>{footerSummary as ReactNode}</box> : null}
          <box flexDirection="row" flexShrink={0} gap={2} paddingTop={1} paddingLeft={3}>
            <Button label={busy ? `${spinner} ${busyLabel}` : confirmLabel} primary keys="ctrl+enter" focused={listFocus && !busy && cursor === CONFIRM_STOP} onPress={confirm} />
            {onCancel ? <Button label="cancelar" disabled={busy ? "" : undefined} focused={listFocus && !busy && cursor === CANCEL_STOP} onPress={leave} /> : null}
          </box>
        </box>
      ) : null}
    </box>
  );
}
