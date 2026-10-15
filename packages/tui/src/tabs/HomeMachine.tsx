import type { MachineSnap } from "@pvx/core";
import { BarMeter } from "../sdk-ui/display.tsx";
import { useTheme } from "../theme-context.tsx";
import { BAR_LABEL_W, coreColumns, heaviestLines, loadParts, machineLayout, processesText, rateText, sizeText, uptimeText, type MachineLayout } from "./home-view.ts";

/** Cells of the dim label of a fact on the right (`processos` is the longest) and the space after it. */
const FACT_LABEL_W = 9;
const SUB_GAP_W = 3;
const COLUMNS_GAP_W = 4;
const SIZE_UNAVAILABLE = "—";

type Used = { used: number; total: number };

function Bar({ label, value, inner, text }: { label: string; value: number; inner: number; text?: string }) {
  return <BarMeter label={label} labelWidth={BAR_LABEL_W} value={value} width={inner} text={text} />;
}

/** One bar per core, filled column by column (1, 2, 3 down the first column, then 4, 5, 6), each stretched to its column. */
function CoreBars({ cores, layout }: { cores: readonly number[]; layout: MachineLayout }) {
  return (
    <box flexDirection="row" columnGap={SUB_GAP_W} flexShrink={0}>
      {coreColumns(cores, layout.rows).map((column) => (
        <box key={column[0]!.index} flexDirection="column" flexShrink={0}>
          {column.map(({ index, value }) => <Bar key={index} label={String(index + 1)} value={value / 100} inner={layout.coreInner} />)}
        </box>
      ))}
    </box>
  );
}

function UsedBar({ label, usage, inner }: { label: string; usage?: Used; inner: number }) {
  if (!usage) return <Bar label={label} value={0} inner={inner} text={SIZE_UNAVAILABLE} />;
  if (!usage.total) return <Bar label={label} value={0} inner={inner} text="0/0" />;
  return <Bar label={label} value={usage.used / usage.total} inner={inner} text={sizeText(usage.used, usage.total)} />;
}

/** Memory, swap and disk, with their size inside the bar. */
function UsedBars({ machine, inner }: { machine: MachineSnap; inner: number }) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <UsedBar label="mem" usage={machine.mem} inner={inner} />
      <UsedBar label="swp" usage={machine.swap} inner={inner} />
      <UsedBar label="dsk" usage={machine.disk} inner={inner} />
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
 * The top of Início, in the style of htop: every core across the width, then memory, swap and disk on the left half and the facts of the machine on the right half.
 * When the half is narrower than the facts, they go under the bars. `width` is the page's inner width.
 */
export function MachineBlock({ machine, product, sessionIp, width }: { machine: MachineSnap; product?: string; sessionIp?: string; width: number }) {
  const layout = machineLayout(width, machine.cpu.cores.length);
  const used = <UsedBars machine={machine} inner={layout.usedInner} />;
  const facts = <Facts machine={machine} product={product} sessionIp={sessionIp} />;
  return (
    <box flexDirection="column" flexShrink={0}>
      <CoreBars cores={machine.cpu.cores} layout={layout} />
      {layout.beside ? (
        <box flexDirection="row" columnGap={COLUMNS_GAP_W} flexShrink={0}>
          {used}
          {facts}
        </box>
      ) : (
        <>
          {used}
          <text wrapMode="none" flexShrink={0}> </text>
          {facts}
        </>
      )}
    </box>
  );
}
