import type { ReactNode } from "react";
import type { PhaseFailure, RunState, RunView, SdkUi, Tone } from "@pvx/sdk";
import { hooks, useKey } from "./host.tsx";
import { fit } from "./columns.ts";
import { Button } from "./button.tsx";
import { Loading, ProgressBar } from "./flow.tsx";
import { LogTail, Notice, Panel, Spacer, Steps, Text } from "./kit.tsx";
import { useCopy } from "./copy.tsx";
import { useNudge } from "../nudge.tsx";
import { BAR_STATE, failureViewOf, VIEW_WORD, type FailureView } from "./run.ts";

/** Columns the failure text loses to the page frame and the notice's glyph. */
const NOTICE_MARGIN = 12;
const MIN_TEXT_WIDTH = 20;

type RunPanelProps = Parameters<SdkUi["RunPanel"]>[0];

function StopKey({ onStop }: { onStop: () => void }) {
  useKey("x", "parar", onStop);
  return null;
}

function CopyKey({ onCopy }: { onCopy: () => void }) {
  useKey("c", "copiar erro", onCopy);
  return null;
}

interface FailureBlockProps {
  failure: FailureView;
  cause: string | undefined;
  width: number;
  onResume: (() => void) | undefined;
}

/** The notice with what failed, the lines under it, the likely cause (when the module knows it) and the way to continue. */
function FailureBlock({ failure, cause, width, onResume }: FailureBlockProps) {
  return (
    <>
      <Notice level={failure.level}>{fit(failure.headline, width)}</Notice>
      {failure.details.map((line, index) => <Text key={index} tone="dim">{fit(line, width)}</Text>)}
      {cause ? <Text tone="dim">causa provável</Text> : null}
      {cause ? <Text>{fit(cause, width * 2)}</Text> : null}
      {onResume ? <Spacer /> : null}
      {onResume ? <Button label="continuar daqui" primary keys="enter" onPress={onResume} /> : null}
    </>
  );
}

function causeOf(run: RunState, cause: RunPanelProps["cause"]): string | undefined {
  const failure: PhaseFailure | undefined = run.state?.failure;
  if (!failure || !cause) return undefined;
  return cause(failure);
}

/** `x` stops the job; a stop that is refused (no root) says why in the footer. */
function useStopper(run: RunState, onStop: (() => void) | undefined): () => void {
  const nudge = useNudge();
  if (onStop) return onStop;
  return () => void run.stop().catch((error: unknown) => nudge(error instanceof Error ? error.message : String(error), "error"));
}

/** The tone of the state word: done is the success color (never the accent), failed is the error color. */
const VIEW_TONE: Record<RunView, Tone> = { idle: "dim", running: "dim", stale: "dim", failed: "error", done: "ok" };

/**
 * A phased run while it goes and after it ends: the bar and the state word, the phases, the failure (with the way to continue), the
 * module's own `children`, and the job log. It only draws what `run` says: the module still owns `useRun`, the start flow and what `done` means.
 */
export function RunPanel({ run, etaMs, onResume, onStop, onExit, cause, loadingLabel = "iniciando…", children }: RunPanelProps) {
  const { cols } = hooks.useViewport();
  const copy = useCopy();
  const stop = useStopper(run, onStop);
  hooks.useBack(onExit);
  if (run.loading || run.view === "idle") return <Loading label={loadingLabel} />;
  const running = run.view === "running" || run.view === "stale";
  const failure = failureViewOf(run.state, run.view, run.status.state === "stopped");
  const width = Math.max(MIN_TEXT_WIDTH, cols - NOTICE_MARGIN);
  const copyText = failure?.copyText ?? "";
  return (
    <Panel>
      {running ? <StopKey onStop={stop} /> : null}
      {copyText ? <CopyKey onCopy={() => void copy(copyText, { title: "erro" })} /> : null}
      <ProgressBar value={run.progress} startedAt={run.state?.startedAt} etaMs={etaMs} state={BAR_STATE[run.view]} />
      <Text tone={VIEW_TONE[run.view]}>{VIEW_WORD[run.view]}</Text>
      <Panel title="fases">
        <Steps items={run.steps} />
      </Panel>
      {failure ? <FailureBlock failure={failure} cause={causeOf(run, cause)} width={width} onResume={onResume} /> : null}
      {children as ReactNode}
      <Panel title="log" grow>
        <LogTail lines={run.lines} />
      </Panel>
    </Panel>
  );
}
