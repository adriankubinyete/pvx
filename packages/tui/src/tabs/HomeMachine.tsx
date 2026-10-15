import type { MachineSnap } from "@pvx/core";
import { BarMeter } from "../sdk-ui/display.tsx";
import { useTheme } from "../theme-context.tsx";
import { BAR_LABEL_W, coreColumns, heaviestLines, loadParts, machineLayout, processesText, rateText, sizeText, sizeWidth, uptimeText, type MachineLayout } from "./home-view.ts";

/** Cells of the dim label of a fact on the right (`processos` is the longest) and the space after it. */
const FACT_LABEL_W = 9;
const SUB_GAP_W = 3;
const COLUMNS_GAP_W = 4;
const SIZE_UNAVAILABLE = "—";

type Used = { used: number; total: number };

function Bar({ label, value, inner, size }: { label: string; value: number; inner: number; size?: string }) {
  return <BarMeter label={label} labelWidth={BAR_LABEL_W} value={value} width={inner} suffix={size} />;
}

/** One bar per core, in columns of up to eight (as htop does), each short. */
function CoreBars({ cores, layout }: { cores: readonly number[]; layout: MachineLayout }) {
  return (
    <box flexDirection="row" columnGap={SUB_GAP_W} flexShrink={0}>
      {coreColumns(cores, layout.rows).map((column) => (
        <box key={column[0]!.index} flexDirection="column" flexShrink={0}>
          {column.map(({ index, value }) => <Bar key={index} label={String(index)} value={value / 100} inner={layout.inner} />)}
        </box>
      ))}
    </box>
  );
}

function UsedBar({ label, usage, inner }: { label: string; usage?: Used; inner: number }) {
  if (!usage) return <Bar label={label} value={0} inner={inner} size={SIZE_UNAVAILABLE} />;
  if (!usage.total) return <Bar label={label} value={0} inner={inner} size="0/0" />;
  return <Bar label={label} value={usage.used / usage.total} inner={inner} size={sizeText(usage.used, usage.total)} />;
}

/** The bars of the left column: every core, then memory, swap and disk. */
function Bars({ machine, layout }: { machine: MachineSnap; layout: MachineLayout }) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <CoreBars cores={machine.cpu.cores} layout={layout} />
      <UsedBar label="mem" usage={machine.mem} inner={layout.inner} />
      <UsedBar label="swp" usage={machine.swap} inner={layout.inner} />
      <UsedBar label="dsk" usage={machine.disk} inner={layout.inner} />
    </box>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={c.dim}>{`${label.padEnd(FACT_LABEL_W)} `}</span>
      {children}
    </text>
  );
}

/** The hostname and what it runs, then the facts of the machine and the heaviest processes. */
function Facts({ machine, product, sessionIp }: { machine: MachineSnap; product?: string; sessionIp?: string }) {
  const { c, g } = useTheme();
  const load = loadParts(machine.cpu.load);
  const heaviest = heaviestLines(machine.top);
  return (
    <box flexDirection="column" flexShrink={0}>
      <text wrapMode="none" flexShrink={0}>
        <span fg={c.text}><b>{machine.host}</b></span>
        <span fg={c.dim}>{`  ${[machine.os, product].filter(Boolean).join(" · ")}`}</span>
      </text>
      <Fact label="ligado"><span fg={c.text}>{uptimeText(machine.uptime)}</span></Fact>
      <Fact label="carga"><span fg={c.text}><b>{load.first}</b>{` ${load.rest}`}</span></Fact>
      {machine.procs === undefined ? null : <Fact label="processos"><span fg={c.text}>{processesText(machine.procs, machine.running)}</span></Fact>}
      <Fact label="rede"><span fg={machine.net ? c.text : c.dim}>{machine.net ? rateText(machine.net, g) : SIZE_UNAVAILABLE}</span></Fact>
      {sessionIp ? <Fact label="sessão"><span fg={c.ip}>{sessionIp}</span></Fact> : null}
      {heaviest.length ? (
        <>
          <text wrapMode="none" flexShrink={0}> </text>
          <text wrapMode="none" flexShrink={0} fg={c.dim}>mais pesados</text>
          {heaviest.map((line) => <text key={line} wrapMode="none" flexShrink={0} fg={c.dim}>{`  ${line}`}</text>)}
        </>
      ) : null}
    </box>
  );
}

/**
 * The top of Início, in the style of htop: the bars on the left (every core, memory, swap, disk) and the facts of the machine on the right.
 * When the width does not fit both, the facts go under the bars. `width` is the page's inner width.
 */
export function MachineBlock({ machine, product, sessionIp, width }: { machine: MachineSnap; product?: string; sessionIp?: string; width: number }) {
  const sizeW = Math.max(sizeWidth(machine.mem.total), sizeWidth(machine.swap?.total ?? 0), sizeWidth(machine.disk?.total ?? 0));
  const layout = machineLayout(width, machine.cpu.cores.length, sizeW);
  const facts = <Facts machine={machine} product={product} sessionIp={sessionIp} />;
  if (layout.beside) {
    return (
      <box flexDirection="row" columnGap={COLUMNS_GAP_W} flexShrink={0}>
        <Bars machine={machine} layout={layout} />
        {facts}
      </box>
    );
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      <Bars machine={machine} layout={layout} />
      <text wrapMode="none" flexShrink={0}> </text>
      {facts}
    </box>
  );
}
