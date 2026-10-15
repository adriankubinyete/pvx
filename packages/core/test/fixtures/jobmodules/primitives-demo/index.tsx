/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { Sdk } from "@pvx/sdk";

// One page per primitive of the stage-1 kit, for the frame tests (80x24 and 120x40).
export default (sdk: Sdk) => {
  const { h, Panel, Text, Notice, Badge, Details, Meter, Spark, Fields, CopyBlock, List, Row, Chip, Button, Scroll, useState } = sdk.ui;

  function Badges() {
    return (
      <Panel>
        <Row fit gap={1}>
          <Badge label="ativo" tone="ok" />
          <Badge label="desatualizado" tone="warn" />
          <Badge label="parado" tone="error" />
          <Badge label="novo" tone="info" />
        </Row>
      </Panel>
    );
  }

  function Notices() {
    const [message, setMessage] = useState("nada resolvido");
    return (
      <Panel>
        <Notice level="ok">lorem aplicado</Notice>
        <Notice level="warn" action={{ label: "resolver", focused: false, onPress: () => setMessage("resolvido") }}>lorem ipsum dolor</Notice>
        <Notice level="error">lorem falhou</Notice>
        <Notice level="info">lorem informa</Notice>
        <Text>{message}</Text>
      </Panel>
    );
  }

  const ITEMS = [
    { label: "motor", value: "nftables", note: "(automático)" },
    { label: "regras", value: "39 de 40 carregadas" },
    { label: "último apply", value: "ontem 03:31", tone: "warn" as const },
    { label: "IP", value: "10.0.0.1", tone: "ip" as const },
  ];

  function Grid() {
    return (
      <Panel>
        <Details items={ITEMS} columns={2} />
      </Panel>
    );
  }

  function Gauges() {
    return (
      <Panel>
        <Meter label="disco  " value={0.41} suffix="18 de 44 GB" />
        <Meter label="memória" value={0.86} />
        <Meter label="exato  " value={0.8} />
        <Spark label="cpu    " values={[8, 15, 10, 25, 18, 9, 8, 20, 32, 55, 30, 18, 10, 12]} />
      </Panel>
    );
  }

  const OPTIONS = [
    { value: "16", label: "16" },
    { value: "18", label: "18" },
    { value: "20", label: "20" },
  ];

  function Choices({ onSubmit }: { onSubmit: (values: Record<string, string | boolean>) => void }) {
    return (
      <Panel>
        <Fields
          fields={[
            { id: "ver", label: "Versão", kind: "choice", style: "radio", options: OPTIONS, help: "recomendada: 18" },
            { id: "modo", label: "Modo", kind: "choice", style: "buttons", options: OPTIONS },
            { id: "extras", label: "Extras", kind: "multi", style: "row", options: OPTIONS },
            { id: "ativo", label: "Ativo", kind: "toggle", text: "lorem ipsum" },
          ]}
          initial={{ ver: "18", modo: "16", extras: "16", ativo: true }}
          onSubmit={onSubmit}
          onCancel={() => {}}
        />
      </Panel>
    );
  }

  function ChoicesPage() {
    const [seen, setSeen] = useState("");
    return (
      <Panel>
        <Choices onSubmit={(values) => setSeen(JSON.stringify(values))} />
        <Text>{seen}</Text>
      </Panel>
    );
  }

  const COPY_ROWS = [
    { label: "acesso web", value: "https://10.0.0.1", tone: "ip" as const },
    { label: "senha web", value: "xxxx-xxxx-xxxx" },
  ];

  function Copy() {
    return (
      <Panel>
        <CopyBlock rows={COPY_ROWS} copyLabel="copiar acesso" title="acesso" />
      </Panel>
    );
  }

  const LIST_ROWS = [
    { id: "a", cells: { name: "alfa", state: "ok" }, mark: { text: "●", tone: "ok" as const } },
    { id: "b", cells: { name: "beta", state: "ok" } },
    { id: "c", cells: { name: "gama", state: "ok" }, mark: { text: "★", tone: "warn" as const } },
  ];

  function Lists() {
    return (
      <Panel>
        <List items={LIST_ROWS} selected="b" columns={[{ id: "name", title: "nome", width: 8 }, { id: "state", title: "estado" }]} />
      </Panel>
    );
  }

  function Chips() {
    return (
      <Panel>
        <Row fit gap={1}>
          <Chip label="todos" state="on" />
          <Chip label="lorem" state="off" />
          <Chip label="ao vivo" />
        </Row>
        <Row fit gap={2}>
          <Button label="principal" primary focused={false} onPress={() => {}} />
          <Button label="secundário" focused={false} onPress={() => {}} />
          <Button label="perigoso" danger focused={false} onPress={() => {}} />
          <Button label="desligado" disabled="falta o token" focused={false} onPress={() => {}} />
        </Row>
      </Panel>
    );
  }

  function Tall() {
    return (
      <Scroll>
        <Panel>
          {Array.from({ length: 60 }, (_, index) => <Text key={index}>{`linha ${index + 1}`}</Text>)}
        </Panel>
      </Scroll>
    );
  }

  return {
    pages: {
      badges: { title: "Selos", render: () => <Badges /> },
      notices: { title: "Avisos", render: () => <Notices /> },
      details: { title: "Detalhes", render: () => <Grid /> },
      gauges: { title: "Medidores", render: () => <Gauges /> },
      choices: { title: "Escolhas", render: () => <ChoicesPage /> },
      copy: { title: "Copiar", render: () => <Copy /> },
      list: { title: "Lista", render: () => <Lists /> },
      chips: { title: "Chips", render: () => <Chips /> },
      tall: { title: "Alta", render: () => <Tall /> },
    },
  };
};
