import type { MachineSnap } from "@pvx/core";
import { fixedPercent } from "../fixed.ts";
import { Meter, Spark } from "../sdk-ui/display.tsx";
import { meterBar, meterTone, percentText } from "../sdk-ui/display.ts";
import { toneColor } from "../sdk-ui/tones.ts";
import { useTheme } from "../theme-context.tsx";
import { coreGrid, coreRows, coresText, GAUGE_GAP_W, GAUGE_INDENT_W, GAUGE_LABEL_W, loadText, machineHeadline, rateText, usedOfText, usedOfWidth, type CoreGrid } from "./home-view.ts";

const CPU_SPARK_W = 14;
/** Cells between the two columns of gauges. */
const GAUGE_COLUMNS_GAP_W = 4;
const MIN_GAUGE_BAR_W = 4;
const MAX_GAUGE_BAR_W = 20;
/** Cells a `Meter` takes besides its bar and its suffix: label, gap, the two spaces and the percentage. */
const METER_CHROME_W = GAUGE_LABEL_W + GAUGE_GAP_W + 2 + 4;
const SUFFIX_GAP_W = 2;
const GAUGE_UNAVAILABLE = "—";

type Used = { used: number; total: number };

function Headline({ machine, product, sessionIp, width }: { machine: MachineSnap; product?: string; sessionIp?: string; width: number }) {
  const { c } = useTheme();
  const head = machineHeadline(machine, product, sessionIp, width);
  const details = (
    <>
      <span fg={c.dim}>{head.details}</span>
      {head.sessionIp ? <span fg={c.ip}>{head.sessionIp}</span> : null}
    </>
  );
  if (head.oneRow) {
    return (
      <text wrapMode="none" flexShrink={0}>
        <span fg={c.text}><b>{head.host}</b></span>
        <span>{"   "}</span>
        {details}
      </text>
    );
  }
  return (
    <>
      <text wrapMode="none" flexShrink={0} fg={c.text}><b>{head.host}</b></text>
      <text wrapMode="none" flexShrink={0}>{details}</text>
    </>
  );
}

function CpuLine({ machine }: { machine: MachineSnap }) {
  const { c } = useTheme();
  return (
    <box flexDirection="row" flexShrink={0}>
      <Spark values={machine.cpu.history} width={CPU_SPARK_W} label={"cpu".padEnd(GAUGE_LABEL_W)} suffix={fixedPercent(machine.cpu.total)} />
      <text wrapMode="none" flexShrink={0} fg={c.dim}>{`  ${coresText(machine.cpu.cores.length)} · carga ${loadText(machine.cpu.load)}`}</text>
    </box>
  );
}

/** Every core as a small meter: its index, a bar that turns to the warn color above 80%, and its percentage. */
function CoreCells({ cores, grid }: { cores: readonly number[]; grid: CoreGrid }) {
  const { c, g } = useTheme();
  return (
    <>
      {coreRows(cores.map((pct) => pct / 100), grid.perRow).map((row) => (
        <text key={row[0]!.index} wrapMode="none" flexShrink={0}>
          <span>{" ".repeat(GAUGE_INDENT_W)}</span>
          {row.map(({ index, value }, position) => {
            const { filled, empty } = meterBar(value, grid.barWidth, g);
            return (
              <span key={index}>
                {position > 0 ? " ".repeat(grid.gap) : ""}
                <span fg={c.dim}>{`${String(index).padStart(grid.idxWidth)} `}</span>
                <span fg={toneColor(c, meterTone(value))}>{filled}</span>
                <span fg={c.dim}>{empty}</span>
                <span fg={c.text}>{percentText(value)}</span>
              </span>
            );
          })}
        </text>
      ))}
    </>
  );
}

/** The bar width that lets every meter of a column end at the same cell, whatever its suffix. */
function barWidthFor(columnWidth: number, totals: readonly number[]): number {
  const suffixWidth = Math.max(0, ...totals.map(usedOfWidth));
  const room = columnWidth - METER_CHROME_W - SUFFIX_GAP_W - suffixWidth;
  return Math.max(MIN_GAUGE_BAR_W, Math.min(MAX_GAUGE_BAR_W, room));
}

function UsageMeter({ label, usage, barWidth }: { label: string; usage?: Used; barWidth: number }) {
  const { c } = useTheme();
  const padded = label.padEnd(GAUGE_LABEL_W);
  if (!usage?.total) {
    return <text wrapMode="none" flexShrink={0}><span fg={c.dim}>{`${padded}${" ".repeat(GAUGE_GAP_W)}`}</span><span fg={c.dim}>{GAUGE_UNAVAILABLE}</span></text>;
  }
  return <Meter value={usage.used / usage.total} width={barWidth} label={padded} suffix={usedOfText(usage.used, usage.total)} />;
}

function NetLine({ net }: { net: MachineSnap["net"] }) {
  const { c, g } = useTheme();
  const label = "rede".padEnd(GAUGE_LABEL_W);
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={c.dim}>{`${label}${" ".repeat(GAUGE_GAP_W)}`}</span>
      <span fg={net ? c.text : c.dim}>{net ? rateText(net, g) : GAUGE_UNAVAILABLE}</span>
    </text>
  );
}

/** Memory and swap on the left, disk and network on the right. */
function Gauges({ machine, width }: { machine: MachineSnap; width: number }) {
  const columnWidth = Math.floor((width - GAUGE_COLUMNS_GAP_W) / 2);
  const left = barWidthFor(columnWidth, [machine.mem.total, machine.swap?.total ?? 0]);
  const right = barWidthFor(columnWidth, [machine.disk?.total ?? 0]);
  return (
    <box flexDirection="row" columnGap={GAUGE_COLUMNS_GAP_W} flexShrink={0}>
      <box width={columnWidth} flexShrink={0} flexDirection="column">
        <UsageMeter label="memória" usage={machine.mem} barWidth={left} />
        <UsageMeter label="swap" usage={machine.swap} barWidth={left} />
      </box>
      <box flexGrow={1} flexDirection="column">
        <UsageMeter label="disco /" usage={machine.disk} barWidth={right} />
        <NetLine net={machine.net} />
      </box>
    </box>
  );
}

/** The top of Início: what the machine is, the cpu with every core, and the gauges. `width` is the page's inner width. */
export function MachineBlock({ machine, product, sessionIp, width }: { machine: MachineSnap; product?: string; sessionIp?: string; width: number }) {
  const grid = coreGrid(machine.cpu.cores.length, width - GAUGE_INDENT_W);
  return (
    <box flexDirection="column" flexShrink={0}>
      <Headline machine={machine} product={product} sessionIp={sessionIp} width={width} />
      <text wrapMode="none" flexShrink={0}> </text>
      <CpuLine machine={machine} />
      <CoreCells cores={machine.cpu.cores} grid={grid} />
      <Gauges machine={machine} width={width} />
    </box>
  );
}
