/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// No imports from React or the host: everything comes from the injected `sdk.ui`.
import type { CommandCtx, Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Panel, Text, KeyHint, Table, Meter, useState, useCommand, useQuery } = sdk.ui;

  // A key's `run()` has no access to component state: the page hands its setter out through this variable.
  let bump: (() => void) | undefined;
  function Counter() {
    const [n, setN] = useState(0);
    bump = () => setN((v) => v + 1);
    return (
      <Panel title="contador">
        <Text>{`n = ${n}`}</Text>
        <Meter value={(n % 10) / 10} />
        <Table columns={["chave", "valor"]} rows={[["n", String(n)]]} />
      </Panel>
    );
  }

  let runStatus: (() => void) | undefined;
  function Overview() {
    const status = useCommand("ui-demo status");
    runStatus = () => void status.run();
    const q = useQuery<string>("ui-demo.state");
    return (
      <Panel title="visão geral">
        <Text tone="info">{status.lastResult ? `status saiu ${status.lastResult.exit}` : "status não rodou"}</Text>
        <Text>{`consulta: ${q.loading ? "..." : q.data}`}</Text>
        <KeyHint keys="s" label="roda status" />
      </Panel>
    );
  }

  let flip: (() => void) | undefined;
  function Board() {
    const [on, setOn] = useState(false);
    flip = () => setOn((v) => !v);
    return (
      <Panel title="quadro">
        <Text tone={on ? "ok" : "dim"}>{`estado: ${on ? "on" : "off"}`}</Text>
      </Panel>
    );
  }

  function Boom(): never {
    throw new Error("quebrou de propósito");
  }

  return {
    commands: {
      status: { help: "Mostra o status e abre a visão geral", page: "overview", run: (ctx: CommandCtx) => ctx.out.success("status ok") },
    },
    queries: { "ui-demo.state": () => "ready" },
    pages: {
      counter: { title: "Contador", render: () => <Counter />, keys: [{ keys: "space", label: "soma 1", run: () => bump?.() }] },
      board: { title: "Quadro", render: () => <Board />, tab: { label: "Demo", order: 5 }, keys: [{ keys: "t", label: "alterna", run: () => flip?.() }] },
      overview: { title: "Visão geral", render: () => <Overview />, keys: [{ keys: "s", label: "roda status", run: () => runStatus?.() }] },
      boom: { title: "Quebrada", render: () => <Boom /> },
    },
  };
};
