// Fields whose value follows the other fields until the technician edits it. Pure.
import type { FieldSpec } from "@pvx/sdk";
import type { Line } from "../lineedit.ts";

type Values = Record<string, string | boolean>;

/** A line starting at its end: the cursor follows the text as the derived value grows. */
export const END_OF_TEXT = Number.POSITIVE_INFINITY;

/** Whether the field takes its value from `derive` now: it has one and the technician has not edited it (an empty field follows again). */
export const isFollowing = (field: FieldSpec, touched: Record<string, boolean>): boolean => field.derive !== undefined && !touched[field.id];

/**
 * The lines as the form shows them: a following field holds what `derive` says of the other values (read with `valuesOf`), the rest are as typed.
 * Derived fields are filled in order, so one may use the one before it.
 */
export function withDerived(fields: FieldSpec[], lines: Record<string, Line>, touched: Record<string, boolean>, valuesOf: (lines: Record<string, Line>) => Values): Record<string, Line> {
  const shown = { ...lines };
  for (const field of fields) {
    if (!isFollowing(field, touched)) continue;
    const text = field.derive!(valuesOf(shown));
    shown[field.id] = { text, cursor: Math.min(lines[field.id]?.cursor ?? END_OF_TEXT, [...text].length) };
  }
  return shown;
}
