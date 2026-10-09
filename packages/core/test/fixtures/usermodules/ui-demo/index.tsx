/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// No imports from React or the host: everything comes from the injected `sdk.ui`.
import type { CommandCtx, Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Panel, Text, KeyHint, Table, Meter, useState, useCommand, useQuery, useKey } = sdk.ui;

  function Counter() {
    const [n, setN] = useState(0);
    useKey("space", "soma 1", () => setN((v) => v + 1));
    useKey("esc", "nunca", () => setN(99)); // reserved: ignored
    return (
      <Panel title="contador">
        <Text>{`n = ${n}`}</Text>
        <Meter value={(n % 10) / 10} />
        <Table columns={["chave", "valor"]} rows={[["n", String(n)]]} />
      </Panel>
    );
  }

  function Overview() {
    const status = useCommand("ui-demo status");
    useKey("s", "roda status", () => void status.run());
    const q = useQuery<string>("ui-demo.state");
    return (
      <Panel title="visão geral">
        <Text tone="info">{status.lastResult ? `status saiu ${status.lastResult.exit}` : "status não rodou"}</Text>
        <Text>{`consulta: ${q.loading ? "..." : q.data}`}</Text>
        <KeyHint keys="s" label="roda status" />
      </Panel>
    );
  }

  function Board() {
    const [on, setOn] = useState(false);
    useKey("t", "alterna", () => setOn((v) => !v));
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
      // `keys` still works for keys that need no component state.
      counter: { title: "Contador", render: () => <Counter />, keys: [{ keys: "x", label: "falha", run: () => { throw new Error("tecla quebrou"); } }] },
      board: { title: "Quadro", render: () => <Board />, tab: { label: "Demo", order: 5 } },
      overview: { title: "Visão geral", render: () => <Overview /> },
      boom: { title: "Quebrada", render: () => <Boom /> },
    },
  };
};
