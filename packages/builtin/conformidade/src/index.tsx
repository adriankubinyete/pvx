/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// Written like any usermodule: only `import type` from the SDK, everything else comes from `sdk.ui`.
// The engine (profiles, evaluation, plan ordering) stays in the host; this module owns the screens.
import type { Conformity, ConformityStep, Sdk, StepAnswer, StepOutcome } from "@pvx/sdk";

/** What the Plano screen remembers while a plan is applied. `steps` is the frozen list on screen. */
interface Run {
  steps: ConformityStep[];
  decided: Record<string, "yes" | "skip">;
  asking?: ConformityStep;
  answer?: (a: StepAnswer) => void;
  /** Set when the apply ended. */
  outcomes?: StepOutcome[];
}

export default (sdk: Sdk) => {
  const { h, Fragment, Panel, Text, useState, useEffect, useConformity, useKey, useTheme } = sdk.ui;

  const hhmm = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  /** The first visit checks; `r` checks again. Both read and fill the host cache the Início panel shows. */
  function useChecked(): Conformity {
    const c = useConformity();
    useEffect(() => {
      if (!c.checkedAt) c.refresh();
    }, []);
    useKey("r", "atualiza", c.refresh);
    return c;
  }

  function Header({ c }: { c: Conformity }) {
    return <Text tone="dim">{c.running ? "verificando…" : c.checkedAt ? `verificado às ${hhmm(c.checkedAt)}` : "não verificado"}</Text>;
  }

  function Resultados() {
    const c = useChecked();
    const { g } = useTheme();
    const mark = { ok: g.ok!, warn: g.warnTag!, error: g.error! };
    const n = (l: string) => c.results.filter((r) => r.level === l).length;
    return (
      <Panel>
        <Header c={c} />
        {c.message ? <Text tone="dim">{c.message}</Text> : null}
        {c.profile ? <Text tone="accent">{`perfil ${c.profile}`}</Text> : null}
        {c.results.map((r, i) => (
          <Text key={i} tone={r.level}>{`[${mark[r.level]}] ${r.text}${r.fix ? `  → ${r.fix}` : ""}`}</Text>
        ))}
        {c.results.length ? <Text tone="dim">{`${n("ok")} ok, ${n("warn")} avisos, ${n("error")} erros`}</Text> : null}
      </Panel>
    );
  }

  const tags = (s: ConformityStep) => {
    const t = [s.implicit && `implícito: ${s.reason}`, s.optIn && "opt-in"].filter(Boolean).join("; ");
    return t ? ` (${t})` : "";
  };

  function Key({ keys, label, run }: { keys: string; label: string; run: () => void }) {
    useKey(keys, label, run);
    return null;
  }

  function Passos({ c, onApply }: { c: Conformity; onApply: () => void }) {
    const { steps, manual } = c.plan;
    return (
      <>
        {steps.length ? <Key keys="a" label="aplica" run={onApply} /> : null}
        {c.message ? <Text tone="dim">{c.message}</Text> : null}
        {steps.map((s, i) => <Text key={s.cmd}>{`${i + 1}. ${s.cmd}${tags(s)} para ${s.for.join(", ")}`}</Text>)}
        {manual.map((m) => <Text key={m} tone="warn">{`manual: ${m}`}</Text>)}
        {c.checkedAt && !c.message && !steps.length && !manual.length ? <Text tone="ok">nada a fazer</Text> : null}
      </>
    );
  }

  function Aplicando({ run, onClose }: { run: Run; onClose: () => void }) {
    const { g } = useTheme();
    const { asking, outcomes } = run;
    const mark = (s: ConformityStep): [string, "ok" | "error" | "dim" | "info" | "accent"] => {
      if (outcomes) {
        const o = outcomes.find((x) => x.step.cmd === s.cmd);
        return !o ? [g.inactive!, "dim"] : o.status === "ok" ? [g.ok!, "ok"] : o.status === "error" ? [g.error!, "error"] : ["-", "dim"];
      }
      const d = run.decided[s.cmd];
      if (d === "skip") return ["-", "dim"];
      if (d === "yes") return asking ? [g.ok!, "ok"] : [g.active!, "info"]; // the next question means it finished
      return s.cmd === asking?.cmd ? [g.cursor!, "accent"] : [g.inactive!, "dim"];
    };
    const failed = outcomes?.find((o) => o.status === "error");
    const done = outcomes?.filter((o) => o.status === "ok").length ?? 0;
    return (
      <>
        {asking && run.answer ? <Ask answer={run.answer} /> : null}
        {outcomes ? <Key keys="enter" label="fecha" run={onClose} /> : null}
        {run.steps.map((s, i) => <Text key={s.cmd} tone={mark(s)[1]}>{`${mark(s)[0]} ${i + 1}. ${s.cmd}`}</Text>)}
        {asking ? <Text tone="info" bold>{`aplicar \`${asking.cmd}\`${asking.optIn ? " (opt-in)" : ""}?  y aplica · s pula · n para`}</Text> : null}
        {!outcomes && !asking ? <Text tone="dim">aplicando…</Text> : null}
        {failed ? <Text tone="error">{`parou em \`${failed.step.cmd}\` (exit ${failed.code}); ${done} passo(s) aplicado(s)`}</Text> : null}
        {outcomes && !failed ? <Text tone="ok">{`${done} passo(s) aplicado(s), ${outcomes.length - done} pulado(s); ${run.steps.length - outcomes.length} não executado(s)`}</Text> : null}
      </>
    );
  }

  function Ask({ answer }: { answer: (a: StepAnswer) => void }) {
    return (
      <>
        <Key keys="y" label="aplica" run={() => answer("yes")} />
        <Key keys="s" label="pula" run={() => answer("skip")} />
        <Key keys="n" label="para" run={() => answer("stop")} />
      </>
    );
  }

  function Plano() {
    const c = useChecked();
    const [run, setRun] = useState<Run | null>(null);
    const patch = (p: Partial<Run>) => setRun((r) => (r ? { ...r, ...p } : r));
    const start = () => {
      if (c.running || run) return;
      setRun({ steps: c.plan.steps.map((s) => ({ ...s })), decided: {} }); // the screen keeps this copy, whatever the cache does meanwhile
      const ask = (step: ConformityStep) =>
        new Promise<StepAnswer>((resolve) =>
          patch({
            asking: step,
            answer: (a) => {
              setRun((r) => (r ? { ...r, asking: undefined, answer: undefined, decided: a === "stop" ? r.decided : { ...r.decided, [step.cmd]: a } } : r));
              resolve(a);
            },
          }),
        );
      void c.apply(ask).then((outcomes) => (patch({ outcomes }), c.refresh()));
    };
    return (
      <Panel>
        <Header c={c} />
        {run ? <Aplicando run={run} onClose={() => setRun(null)} /> : <Passos c={c} onApply={start} />}
      </Panel>
    );
  }

  return {
    pages: {
      conformidade: { title: "conformidade", render: () => <Resultados />, tab: { label: "Conformidade", order: 1 } },
      plano: { title: "plano", render: () => <Plano />, tab: { label: "Plano", order: 2 }, role: "plan" as const },
    },
  };
};
