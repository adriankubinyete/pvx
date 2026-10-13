/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// Written like any usermodule: only `import type` from the SDK, everything else comes from `sdk.ui`.
// The engine (profiles, evaluation, plan ordering) stays in the host; this module owns the screen:
// results (main) and plan (secondary) as two numbered panels, side by side from 100 columns, stacked below.
import type { Conformity, ConformityStep, Sdk, StepAnswer, StepOutcome, Tone } from "@pvx/sdk";

/** What the plan panel remembers while a plan is applied. `steps` is the frozen list on screen. */
interface Run {
  steps: ConformityStep[];
  decided: Record<string, "yes" | "skip">;
  asking?: ConformityStep;
  answer?: (a: StepAnswer) => void;
  /** Set when the apply ended. */
  outcomes?: StepOutcome[];
}

interface Line {
  text: string;
  tone?: Tone;
}

/** Rows the page frame, the footer, the tab bar (if the page is a tab) and the header line take from the terminal height. */
const CHROME = 6;
const WIDE = 100;

/** The page has no scroll: `items` are clipped to `max` lines with a "+N" line, and `tail` always shows. */
const clip = (items: Line[], max: number, tail: Line[] = []): Line[] => {
  const room = Math.max(1, max - tail.length);
  const shown = items.length > room ? [...items.slice(0, room - 1), { text: `… +${items.length - room + 1} mais`, tone: "dim" as Tone }] : items;
  return [...shown, ...tail];
};

export default (sdk: Sdk) => {
  const { h, Fragment, Panel, Row, Text, useState, useEffect, useConformity, useKey, useNudge, usePanels, useTheme, useViewport } = sdk.ui;

  const hhmm = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const Lines = ({ lines }: { lines: Line[] }) => <>{lines.map((l, i) => <Text key={i} tone={l.tone}>{l.text}</Text>)}</>;

  function Key({ keys, label, run }: { keys: string; label: string; run: () => void }) {
    useKey(keys, label, run);
    return null;
  }

  function Resultados({ c, max }: { c: Conformity; max: number }) {
    const { g } = useTheme();
    const mark = { ok: g.ok!, warn: g.warnTag!, error: g.error! };
    const n = (l: string) => c.results.filter((r) => r.level === l).length;
    const items: Line[] = [
      ...(c.message ? [{ text: c.message, tone: "dim" as Tone }] : []),
      ...(c.profile ? [{ text: `perfil ${c.profile}`, tone: "accent" as Tone }] : []),
      ...c.results.map((r) => ({ text: `[${mark[r.level]}] ${r.text}${r.fix ? `  → ${r.fix}` : ""}`, tone: r.level as Tone })),
    ];
    const tail: Line[] = c.results.length ? [{ text: `${n("ok")} ok, ${n("warn")} avisos, ${n("error")} erros`, tone: "dim" }] : [];
    return <Lines lines={clip(items, max, tail)} />;
  }

  const tags = (s: ConformityStep) => {
    const t = [s.implicit && `implícito: ${s.reason}`, s.optIn && "opt-in"].filter(Boolean).join("; ");
    return t ? ` (${t})` : "";
  };

  function Passos({ c, max }: { c: Conformity; max: number }) {
    const { steps, manual } = c.plan;
    const items: Line[] = [
      ...(c.message ? [{ text: c.message, tone: "dim" as Tone }] : []),
      ...steps.map((s, i) => ({ text: `${i + 1}. ${s.cmd}${tags(s)} para ${s.for.join(", ")}` })),
      ...manual.map((m) => ({ text: `manual: ${m}`, tone: "warn" as Tone })),
      ...(c.checkedAt && !c.message && !steps.length && !manual.length ? [{ text: "nada a fazer", tone: "ok" as Tone }] : []),
    ];
    return <Lines lines={clip(items, max)} />;
  }

  function Aplicando({ run, max, onClose }: { run: Run; max: number; onClose: () => void }) {
    const { g } = useTheme();
    const { asking, outcomes } = run;
    const mark = (s: ConformityStep): [string, Tone] => {
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
    const tail: Line[] = [
      ...(asking ? [{ text: `aplicar \`${asking.cmd}\`${asking.optIn ? " (opt-in)" : ""}?  y aplica · s pula · n para`, tone: "info" as Tone }] : []),
      ...(!outcomes && !asking ? [{ text: "aplicando…", tone: "dim" as Tone }] : []),
      ...(failed ? [{ text: `parou em \`${failed.step.cmd}\` (exit ${failed.code}); ${done} passo(s) aplicado(s)`, tone: "error" as Tone }] : []),
      ...(outcomes && !failed ? [{ text: `${done} passo(s) aplicado(s), ${outcomes.length - done} pulado(s); ${run.steps.length - outcomes.length} não executado(s)`, tone: "ok" as Tone }] : []),
    ];
    const items: Line[] = run.steps.map((s, i) => ({ text: `${mark(s)[0]} ${i + 1}. ${s.cmd}`, tone: mark(s)[1] }));
    return (
      <>
        {asking && run.answer ? <Ask answer={run.answer} /> : null}
        {outcomes ? <Key keys="enter" label="fecha" run={onClose} /> : null}
        <Lines lines={clip(items, max, tail)} />
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

  function Conformidade() {
    const c = useConformity();
    const { g } = useTheme();
    const { cols, rows } = useViewport();
    const nudge = useNudge();
    const nav = usePanels();
    const [panel, setPanel] = useState<1 | 2>(1);
    const [run, setRun] = useState<Run | null>(null);
    // The first visit checks; `r` checks again. Both read and fill the host cache the Início panel shows.
    useEffect(() => {
      if (!c.checkedAt) c.refresh();
    }, []);
    useKey("r", "atualiza", c.refresh);
    // Same rule as Início: the arrows go to the panel really on that side (→ side by side, ↓ stacked).
    // The panels here have no items, so enter has nothing to enter.
    const move = (key: "left" | "right" | "up" | "down" | "enter") => {
      const st = nav.step({ panel: String(panel), inside: false }, key, () => 0);
      if (!st) return;
      if (st.bar) return nav.toBar();
      return st.nudge ? nudge(st.nudge) : setPanel(Number(st.panel) as 1 | 2);
    };
    useKey("←", "painel", () => move("left"));
    useKey("→", "painel", () => move("right"), { help: true });
    useKey("↑", "painel", () => move("up"), { help: true });
    useKey("↓", "painel", () => move("down"), { help: true });
    useKey("enter", "entra", () => (run?.outcomes ? setRun(null) : move("enter")), { help: true }); // a finished apply uses enter to close
    useKey("1", "resultados", () => setPanel(1), { help: true });
    useKey("2", "plano", () => setPanel(2), { help: true });

    const patch = (p: Partial<Run>) => setRun((r) => (r ? { ...r, ...p } : r));
    const start = () => {
      if (c.running || run) return;
      setPanel(2);
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

    // Inner lines of each panel: wide gives both the full height, narrow splits it (results first).
    const body = Math.max(4, rows - CHROME - 1);
    const wide = cols >= WIDE;
    const inner = wide ? [body - 2, body - 2] : [Math.floor(body / 2) - 2, Math.ceil(body / 2) - 2];
    const frame = (n: 1 | 2, title: string, children: unknown) => (
      <Panel key={n} panelRef={nav.ref(String(n))} title={`[${n}] ${title}${panel === n ? ` ${g.active}` : ""}`} tone={panel === n ? "accent" : undefined} grow={wide}>{children}</Panel>
    );
    const header = c.running ? "verificando…" : c.checkedAt ? `verificado às ${hhmm(c.checkedAt)}` : "não verificado";
    const plan = run ? <Aplicando run={run} max={inner[1]!} onClose={() => setRun(null)} /> : <Passos c={c} max={inner[1]!} />;
    const panels = [frame(1, "resultados", <Resultados c={c} max={inner[0]!} />), frame(2, "plano", plan)];
    return (
      <Panel>
        {c.plan.steps.length > 0 && !run ? <Key keys="a" label="aplica" run={start} /> : null}
        <Text tone="dim">{header}</Text>
        {wide ? <Row>{panels}</Row> : panels}
      </Panel>
    );
  }

  return {
    pages: {
      conformidade: { title: "conformidade", render: () => <Conformidade />, role: "plan" as const },
    },
  };
};
