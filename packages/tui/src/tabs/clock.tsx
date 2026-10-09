import { memo, useEffect, useState } from "react";
import { useTheme } from "../theme-context.tsx";

const DAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** Richest first. Each drops one part: weekday, then date, then seconds; `HH:MM` stays. */
export const CLOCK_FORMS = ["full", "noDay", "time", "short"] as const;
export type ClockForm = (typeof CLOCK_FORMS)[number];

export function clockText(d: Date, form: ClockForm): string {
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const hms = `${hm}:${p2(d.getSeconds())}`;
  const date = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
  return form === "full" ? `${DAYS[d.getDay()]} ${date} ${hms}` : form === "noDay" ? `${date} ${hms}` : form === "time" ? hms : hm;
}
/** Width of every form (the digits never change width). */
export const clockWidth = (form: ClockForm) => clockText(new Date(0), form).length;

/** The richest form that fits in `room` columns, else the shortest. */
export const pickForm = (room: number): ClockForm => CLOCK_FORMS.find((f) => clockWidth(f) <= room) ?? "short";

/**
 * The only thing that ticks: its own state and one interval aligned to the second boundary, so a tick re-renders
 * this text and nothing else (memo: the bar and the screen do not render again).
 */
export const Clock = memo(function Clock({ form, now }: { form: ClockForm; now: () => number }) {
  const { c } = useTheme();
  const [t, setT] = useState(now);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => (setT(now()), (iv = setInterval(() => setT(now()), 1000))), 1000 - (now() % 1000));
    return () => (clearTimeout(first), clearInterval(iv));
  }, [now]);
  return <text fg={c.dim} wrapMode="none" flexShrink={0}>{`${clockText(new Date(t), form)} · `}</text>;
});
