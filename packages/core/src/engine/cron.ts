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

/** `sdk.cron`. */
export const cronKit: CronKit = { normalize, validate, describe };
