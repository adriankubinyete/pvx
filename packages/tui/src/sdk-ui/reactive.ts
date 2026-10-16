// What a form does with the current values: which fields show, where the focus goes when that changes, how wide a value cell is, when the module hears of a change. Pure, but `useOnChange`.
import { useEffect, useRef } from "react";
import type { FieldSpec } from "@pvx/sdk";

type Values = Record<string, string | boolean>;
type ValueWidth = NonNullable<FieldSpec["width"]>;

/** A field with no `when` always shows. */
export const isShown = (field: FieldSpec, values: Values): boolean => field.when === undefined || field.when(values);

/** `values` without the fields that are hidden now: what the module is handed (a hidden field is not submitted). */
export function withoutHidden(fields: FieldSpec[], shown: FieldSpec[], values: Values): Values {
  const visible = new Set(shown.map((field) => field.id));
  const hidden = fields.filter((field) => !visible.has(field.id)).map((field) => field.id);
  return Object.fromEntries(Object.entries(values).filter(([id]) => !hidden.includes(id)));
}

/**
 * The focus (an index: the fields, then the buttons) after the shown fields changed from `before` to `after` (ids): the same field keeps it
 * even when it moved, a button stays a button, and a field that went away hands it to whatever took its place.
 */
export function refocus(before: string[], after: string[], focus: number): number {
  if (focus >= before.length) return after.length + (focus - before.length);
  const moved = after.indexOf(before[focus]!);
  return moved >= 0 ? moved : Math.min(focus, Math.max(0, after.length - 1));
}

/** The narrowest a value cell is drawn, whatever the terminal. */
const MIN_CELL_W = 12;
/** `short`: a code, a number, a time. */
const SHORT_CELL_W = 20;
/** The least `normal` and `long` take on a wide enough terminal. */
const NORMAL_MIN_W = 30;
/** Shares of the form width: the default cell grows to 40% of it, `long` to 60%. */
const NORMAL_SHARE = 0.4;
const LONG_SHARE = 0.6;

/** The width of a value cell: it grows with the form (`formWidth`), by the field's `width`, and never passes `room` (what is left of the line after the label). */
export function valueWidth(width: ValueWidth | undefined, formWidth: number, room: number): number {
  const wanted: Record<ValueWidth, number> = {
    short: SHORT_CELL_W,
    normal: Math.max(NORMAL_MIN_W, Math.floor(formWidth * NORMAL_SHARE)),
    long: Math.max(NORMAL_MIN_W, Math.floor(formWidth * LONG_SHARE)),
  };
  return Math.max(MIN_CELL_W, Math.min(wanted[width ?? "normal"], room));
}

/** Calls `onChange(values)` after the values changed (not on the first draw). Two different objects with the same content are not a change. */
export function useOnChange(values: Values, onChange: ((values: Values) => void) | undefined): void {
  const key = JSON.stringify(values);
  const last = useRef(key);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (key === last.current) return;
    last.current = key;
    latest.current?.(values);
  }, [key]);
}
