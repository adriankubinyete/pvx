// `sdk.cron`: validation and a short pt-BR description of a five-field cron expression. Pure.
import type { CronKit } from "@pvx/sdk";

interface CronField {
  name: string;
  min: number;
  max: number;
}

/** minute, hour, day of month, month, day of week (0 and 7 are Sunday). */
const CRON_FIELDS: CronField[] = [
  { name: "minuto", min: 0, max: 59 },
  { name: "hora", min: 0, max: 23 },
  { name: "dia do mês", min: 1, max: 31 },
  { name: "mês", min: 1, max: 12 },
  { name: "dia da semana", min: 0, max: 7 },
];

/** `*`, `5` or `1-5`, then an optional `/step`. Names (`mon`, `jan`) are not accepted: numbers only. */
const CRON_ITEM = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;
const WHITESPACE = /\s+/;
const NUMBER = /^\d+$/;

const normalize = (expression: string): string => expression.trim().split(WHITESPACE).join(" ");

function checkItem(item: string, field: CronField): string | undefined {
  const match = CRON_ITEM.exec(item);
  if (!match) return `${field.name}: "${item}" não é um valor de cron`;
  const [, range, step] = match;
  if (step !== undefined && Number(step) < 1) return `${field.name}: o passo precisa ser 1 ou mais`;
  if (range === "*") return undefined;
  if (step !== undefined && !range!.includes("-")) return `${field.name}: o passo vale só depois de * ou de uma faixa (1-5/2)`;
  const [first, last] = range!.split("-").map(Number);
  const end = last ?? first!;
  if (first! < field.min || end > field.max) return `${field.name}: use de ${field.min} a ${field.max}`;
  if (first! > end) return `${field.name}: o início passa do fim`;
  return undefined;
}

function checkField(text: string, field: CronField): string | undefined {
  for (const item of text.split(",")) {
    const problem = checkItem(item, field);
    if (problem) return problem;
  }
  return undefined;
}

function validate(expression: string): string | undefined {
  const fields = normalize(expression).split(" ");
  if (fields.length !== CRON_FIELDS.length) return "agendamento inválido: use 5 campos (minuto hora dia mês semana)";
  for (const [index, text] of fields.entries()) {
    const problem = checkField(text, CRON_FIELDS[index]!);
    if (problem) return `agendamento inválido, ${problem}`;
  }
  return undefined;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");
const timeOf = (hour: string, minute: string): string => `${pad2(Number(hour))}:${pad2(Number(minute))}`;

/** Day of week as the technician reads it (0 and 7 are Sunday). */
const WEEKDAY: Record<string, string> = { "0": "dom", "1": "seg", "2": "ter", "3": "qua", "4": "qui", "5": "sex", "6": "sáb", "7": "dom" };

const EVERY_STEP = /^\*\/(\d+)$/;

interface Fields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

function fieldsOf(expression: string): Fields {
  const [minute = "", hour = "", dayOfMonth = "", month = "", dayOfWeek = ""] = normalize(expression).split(" ");
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** `a cada 15 min`, `de hora em hora`, `a cada 2 h`, or undefined when the expression is not that rhythm. */
function describeRepeating({ minute, hour, dayOfMonth, month, dayOfWeek }: Fields): string | undefined {
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") return undefined;
  const everyMinutes = EVERY_STEP.exec(minute)?.[1];
  if (everyMinutes !== undefined && hour === "*") return `a cada ${everyMinutes} min`;
  if (minute === "0" && hour === "*") return "de hora em hora";
  const everyHours = EVERY_STEP.exec(hour)?.[1];
  if (minute === "0" && everyHours !== undefined) return `a cada ${everyHours} h`;
  return undefined;
}

/** `diário 03:30`, `semanal dom 02:00`, `mensal dia 5 03:30`, or undefined when the time or the day is not a single number. */
function describeAtTime({ minute, hour, dayOfMonth, month, dayOfWeek }: Fields): string | undefined {
  if (!NUMBER.test(minute) || !NUMBER.test(hour) || month !== "*") return undefined;
  const time = timeOf(hour, minute);
  if (dayOfMonth === "*" && dayOfWeek === "*") return `diário ${time}`;
  if (dayOfMonth === "*" && WEEKDAY[dayOfWeek]) return `semanal ${WEEKDAY[dayOfWeek]} ${time}`;
  if (NUMBER.test(dayOfMonth) && dayOfWeek === "*") return `mensal dia ${Number(dayOfMonth)} ${time}`;
  return undefined;
}

function describe(expression: string): string {
  const fields = fieldsOf(expression);
  return describeRepeating(fields) ?? describeAtTime(fields) ?? normalize(expression);
}

// ---- the next run ----

const SUNDAY_AS_SEVEN = 7;
/** Days searched ahead: enough for `0 0 29 2 *`, which skips up to eight years around a century that is not a leap year. */
const LAST_SEARCHED_DAY = 366 * 8;

/** One comma item of a field (a value, a range, a step on `*` or on a range) as the values it holds. The expression was validated first. */
function itemValues(item: string, field: CronField): number[] {
  const match = CRON_ITEM.exec(item)!;
  const [, range = "*", stepText] = match;
  const step = stepText === undefined ? 1 : Number(stepText);
  const [first = field.min, last = first] = range === "*" ? [field.min, field.max] : range.split("-").map(Number);
  const values: number[] = [];
  for (let value = first; value <= last; value += step) values.push(value);
  return values;
}

const valuesOf = (text: string, field: CronField): Set<number> => new Set(text.split(",").flatMap((item) => itemValues(item, field)));

/** Day of week 7 is Sunday, the same as 0. */
const sundayAsZero = (days: Set<number>): Set<number> => new Set([...days].map((day) => (day === SUNDAY_AS_SEVEN ? 0 : day)));

const ascending = (values: Set<number>): number[] => [...values].sort((first, second) => first - second);

interface Schedule {
  minutes: number[];
  hours: number[];
  months: Set<number>;
  daysOfMonth: Set<number>;
  daysOfWeek: Set<number>;
  /** Both day fields are restricted: cron runs on a day that matches EITHER (not both). */
  eitherDay: boolean;
}

/** A day field that starts with `*` (`*` alone or with a step) does not restrict the day, as in vixie cron. */
const isRestricted = (text: string): boolean => !text.startsWith("*");

function scheduleOf(expression: string): Schedule {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = normalize(expression).split(" ") as [string, string, string, string, string];
  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = CRON_FIELDS as [CronField, CronField, CronField, CronField, CronField];
  return {
    minutes: ascending(valuesOf(minute, minuteField)),
    hours: ascending(valuesOf(hour, hourField)),
    months: valuesOf(month, monthField),
    daysOfMonth: valuesOf(dayOfMonth, dayOfMonthField),
    daysOfWeek: sundayAsZero(valuesOf(dayOfWeek, dayOfWeekField)),
    eitherDay: isRestricted(dayOfMonth) && isRestricted(dayOfWeek),
  };
}

function runsOnDay(schedule: Schedule, day: Date): boolean {
  if (!schedule.months.has(day.getMonth() + 1)) return false;
  const onDayOfMonth = schedule.daysOfMonth.has(day.getDate());
  const onDayOfWeek = schedule.daysOfWeek.has(day.getDay());
  return schedule.eitherDay ? onDayOfMonth || onDayOfWeek : onDayOfMonth && onDayOfWeek;
}

/** The local time `hour:minute` of `day`, or `undefined` when the clock never shows it (a spring-forward gap makes `Date` slide it to the next hour). */
function localTime(day: Date, hour: number, minute: number): Date | undefined {
  const time = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
  return time.getHours() === hour && time.getMinutes() === minute ? time : undefined;
}

/** The first run of `day` after `after`; `undefined` when none is left that day. */
function firstRunAfter(schedule: Schedule, day: Date, after: number): Date | undefined {
  for (const hour of schedule.hours) {
    for (const minute of schedule.minutes) {
      const time = localTime(day, hour, minute);
      if (time && time.getTime() > after) return time;
    }
  }
  return undefined;
}

/**
 * The next run strictly after `from`, in local time. It walks day by day (a day is built from its calendar fields, so a daylight-saving change
 * cannot shift it): a time the clock skips is not a run, and a time it repeats runs once, at its first pass.
 */
function next(expression: string, from: Date = new Date()): Date | undefined {
  if (validate(expression) !== undefined) return undefined;
  const schedule = scheduleOf(expression);
  for (let offset = 0; offset <= LAST_SEARCHED_DAY; offset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    if (!runsOnDay(schedule, day)) continue;
    const found = firstRunAfter(schedule, day, from.getTime());
    if (found) return found;
  }
  return undefined;
}

/** `sdk.cron`. */
export const cronKit: CronKit = { normalize, validate, describe, next };
