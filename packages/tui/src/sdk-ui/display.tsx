import type { Component, DetailItem, SdkUi } from "@pvx/sdk";
import { useLayout } from "../layout.ts";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import { barMeterParts, columnWidth, DETAILS_GAP, detailColumnCount, detailColumns, meterBar, meterTone, percentText, sparkSuffix, sparkText, valueOffset, type DetailColumn } from "./display.ts";
import { toneColor as tone } from "./tones.ts";

type Props<K extends keyof SdkUi> = SdkUi[K] extends Component<infer P> ? P : never;

const DEFAULT_METER_WIDTH = 20;
const DEFAULT_SPARK_WIDTH = 14;
const SPARK_MAX = 100;

/** A solid chip with bold uppercase text: the state of something at a glance. */
export function Badge({ label, tone: level = "ok" }: Props<"Badge">) {
  const { c } = useTheme();
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={c.bg} bg={tone(c, level)}><b>{` ${clean(label).toLocaleUpperCase("pt-BR")} `}</b></span>
    </text>
  );
}

const padTo = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - [...text].length));

/** The spans of one label/value cell, padded to its column so the next column starts in the same place. */
function DetailCell({ item, column, last }: { item: DetailItem | undefined; column: DetailColumn; last: boolean }) {
  const { c } = useTheme();
  if (!item) return <span>{" ".repeat(columnWidth(column))}</span>;
  const value = clean(item.value);
  const note = item.note ? ` ${clean(item.note)}` : "";
  const used = valueOffset(column) + [...value].length + [...note].length;
  return (
    <>
      <span fg={c.dim}>{padTo(clean(item.label), valueOffset(column))}</span>
      <span fg={tone(c, item.tone)}>{value}</span>
      <span fg={c.dim}>{note}</span>
      {last ? null : <span>{" ".repeat(columnWidth(column) - used)}</span>}
    </>
  );
}

/** A label/value grid, one or two columns (two only from 100 terminal columns). */
export function Details({ items, columns = 1 }: Props<"Details">) {
  const { cols } = useLayout();
  const grid = detailColumns(items, detailColumnCount(columns, cols));
  const rows = Math.max(...grid.map((column) => column.items.length));
  return (
    <box flexDirection="column" flexShrink={0}>
      {Array.from({ length: rows }, (_, row) => (
        <text key={row} wrapMode="none" flexShrink={0}>
          {grid.map((column, index) => (
            <span key={index}>
              {index > 0 ? <span>{" ".repeat(DETAILS_GAP)}</span> : null}
              <DetailCell item={column.items[row]} column={column} last={index === grid.length - 1} />
            </span>
          ))}
        </text>
      ))}
    </box>
  );
}

/** The dim label before a meter or a spark, with the two spaces after it. */
function GaugeLabel({ label }: { label?: string }) {
  const { c } = useTheme();
  return label ? <span fg={c.dim}>{`${clean(label)}  `}</span> : null;
}

/** A thin usage bar with the percentage and an optional suffix. */
export function Meter({ value, width = DEFAULT_METER_WIDTH, label, suffix, warnAbove }: Props<"Meter">) {
  const { c, g } = useTheme();
  const { filled, empty } = meterBar(value, width, g);
  return (
    <text wrapMode="none" flexShrink={0}>
      <GaugeLabel label={label} />
      <span fg={tone(c, meterTone(value, warnAbove))}>{filled}</span>
      <span fg={c.dim}>{empty}</span>
      <span fg={c.text}>{`  ${percentText(value)}`}</span>
      {suffix ? <span fg={c.dim}>{`  ${clean(suffix)}`}</span> : null}
    </text>
  );
}

/** A time series as one row of blocks. */
export function Spark({ values, width = DEFAULT_SPARK_WIDTH, label, suffix, max = SPARK_MAX }: Props<"Spark">) {
  const { c, g } = useTheme();
  const after = suffix ?? sparkSuffix(values, max);
  return (
    <text wrapMode="none" flexShrink={0}>
      <GaugeLabel label={label} />
      <span fg={c.accent}>{sparkText(values, width, max, g)}</span>
      {after ? <span fg={c.text}>{`  ${clean(after)}`}</span> : null}
    </text>
  );
}

const DEFAULT_BAR_METER_W = 30;

/** The bar of a system monitor: `label[|||||        54.0%] suffix`. */
export function BarMeter({ value, width = DEFAULT_BAR_METER_W, label, labelWidth, suffix, text, warnAbove }: Props<"BarMeter">) {
  const { c } = useTheme();
  const { filled, empty, percent } = barMeterParts(value, width, text === undefined ? undefined : clean(text));
  const labelText = label === undefined ? "" : clean(label).padEnd(labelWidth ?? 0);
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={c.info}>{labelText}</span>
      <span fg={c.dim}>{"["}</span>
      <span fg={tone(c, meterTone(value, warnAbove))}>{filled}</span>
      <span>{empty}</span>
      <span fg={c.dim}>{`${percent}]`}</span>
      {suffix ? <span fg={c.dim}>{` ${clean(suffix)}`}</span> : null}
    </text>
  );
}
