/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { CommandCtx, Sdk } from "@pvx/sdk";

// Pages that exercise the newer SDK pieces: List window and row action, Panel shrink, Notice, useNudge tones, refetch, useRun.
export default (sdk: Sdk) => {
  const { h, Panel, Text, List, Notice, useState, useKey, useNudge, useQuery, useRun } = sdk.ui;
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  let reads = 0;

  /** Fails with a StepError while the `broken` flag is set. */
  async function migrate(ctx: CommandCtx) {
    if (!ctx.store.get("broken")) return;
    await ctx.shell.must("sh", ["-c", "echo erro >&2; exit 2"]);
  }

  /** `clickOpens` is the `actionOnClick` of the list. */
  function Rows({ clickOpens = true }: { clickOpens?: boolean }) {
    const [selected, setSelected] = useState("a");
    const [opened, setOpened] = useState("nenhuma");
    const nudge = useNudge();
    const index = ids.indexOf(selected);
    useKey("j", "desce", () => setSelected(ids[Math.min(ids.length - 1, index + 1)]!));
    useKey("n", "avisa", () => nudge("salvo", "ok"));
    useKey("w", "alerta", () => nudge("cuidado", "warn"));
    useKey("x", "falha", () => nudge("quebrou", "error"));
    return (
      <Panel>
        <Panel title="regras" shrink>
          <List items={ids.map((id) => ({ id, label: `linha ${id}` }))} selected={selected} maxRows={3} onPress={setSelected} onAction={(id) => setOpened(id)} actionOnClick={clickOpens} />
        </Panel>
        <Text>{`aberta=${opened}`}</Text>
        <Notice level="warn">precisa aplicar</Notice>
      </Panel>
    );
  }

  /** Two lists with `onAction` and the same `selected` (the id lives in one of them): `enter` must be registered once. */
  function TwoLists() {
    const [opened, setOpened] = useState("nenhuma");
    return (
      <Panel>
        <List items={[{ id: "a", label: "linha a" }]} selected="b" onAction={(id) => setOpened(`cima:${id}`)} />
        <List items={[{ id: "b", label: "linha b" }]} selected="b" onAction={(id) => setOpened(`baixo:${id}`)} />
        <Text>{`aberta=${opened}`}</Text>
      </Panel>
    );
  }

  function Refetch() {
    const count = useQuery<number>("kit-demo.count");
    useKey("r", "lê", () => void count.refetch());
    return <Panel><Text>{`count=${count.data ?? "-"}`}</Text></Panel>;
  }

  /** `trailing` is the phases that do not hold the run back (the last one, a countdown). */
  function Run({ trailing }: { trailing?: string[] }) {
    const run = useRun("setup", { trailing });
    const seconds = run.steps.map((step) => Math.floor((step.elapsedMs ?? 0) / 1000)).join(",");
    return (
      <Panel>
        <Text>{`view=${run.view} job=${run.jobView} current=${String(run.current)} progress=${Math.round(run.progress * 100)} loading=${String(run.loading)}`}</Text>
        <Text>{`seconds=${seconds}`}</Text>
        {run.steps.map((step) => <Text key={step.id}>{`${step.id}:${step.state}`}</Text>)}
      </Panel>
    );
  }

  return {
    commands: {
      install: {
        help: "Runs three phases; `database` fails while the flag is set",
        run: async (ctx: CommandCtx) => {
          const result = await ctx.phases.run("setup", [
            { id: "repos", label: "repos", run: () => {} },
            { id: "packages", label: "pacotes", run: () => {} },
            { id: "database", label: "banco", run: () => migrate(ctx) },
          ]);
          if (!result.ok) ctx.out.error(`parou em ${result.failedPhase}`);
        },
      },
      break: { help: "Breaks the database phase", run: (ctx: CommandCtx) => ctx.store.set("broken", true) },
      fix: { help: "Fixes it", run: (ctx: CommandCtx) => ctx.store.delete("broken") },
    },
    queries: { "kit-demo.count": () => ++reads },
    pages: {
      rows: { title: "Linhas", render: () => <Rows /> },
      "rows-select": { title: "Linhas (clique seleciona)", render: () => <Rows clickOpens={false} /> },
      "two-lists": { title: "Duas listas", render: () => <TwoLists /> },
      refetch: { title: "Refetch", render: () => <Refetch /> },
      run: { title: "Run", render: () => <Run /> },
      "run-trailing": { title: "Run (database trailing)", render: () => <Run trailing={["database"]} /> },
    },
  };
};
