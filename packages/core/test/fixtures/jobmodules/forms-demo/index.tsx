/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { Sdk } from "@pvx/sdk";

// Pages for the pieces a module draws around a form: `ButtonRow` as one stop of a section, the `Panel` aside and the full job log.
export default (sdk: Sdk) => {
  const { h, Panel, Text, List, ButtonRow, useState, useKey, useJobLog, usePageFocused } = sdk.ui;
  const ROWS = ["a", "b"];
  const ACTIONS = "actions";
  const STOPS = [...ROWS, ACTIONS];

  /** A list and, under it, a row of buttons that is the last stop: `↑` `↓` walk the stops, `←` `→` and `enter` belong to the row while it has the focus. */
  function Section() {
    const [selected, setSelected] = useState("a");
    const [log, setLog] = useState<string[]>([]);
    const pageFocused = usePageFocused();
    const move = (step: number) => setSelected(STOPS[(STOPS.indexOf(selected) + step + STOPS.length) % STOPS.length]!);
    useKey("↓", "desce", () => move(1), { help: true });
    useKey("↑", "sobe", () => move(-1), { help: true });
    const onRow = pageFocused && selected === ACTIONS;
    const buttons = [
      { label: "novo", primary: true, onPress: () => setLog((lines) => [...lines, "novo"]) },
      { label: "rodar agora", onPress: () => setLog((lines) => [...lines, "rodar"]) },
      { label: "sem token", disabled: "falta o token", onPress: () => setLog((lines) => [...lines, "nunca"]) },
      { label: "apagar", danger: true, onPress: () => setLog((lines) => [...lines, "apagar"]) },
    ];
    return (
      <Panel>
        <Panel title="[1] Rotinas" aside="2 rotinas · próxima hoje 03:30" tone="accent">
          <List items={ROWS.map((id) => ({ id, label: `linha ${id}` }))} selected={ROWS.includes(selected) ? selected : undefined} />
          <ButtonRow buttons={buttons} focused={onRow} />
        </Panel>
        <Text>{`parada=${selected} pressionados=${log.join(",") || "-"}`}</Text>
      </Panel>
    );
  }

  /** `l` opens the whole log of the job `backup`. */
  function JobLog() {
    const openJobLog = useJobLog();
    useKey("l", "log completo", () => openJobLog("backup"));
    return <Panel><Text>o log do backup</Text></Panel>;
  }

  return {
    pages: {
      section: { title: "Seção", tab: true, render: () => <Section /> },
      "job-log": { title: "Log", tab: true, render: () => <JobLog /> },
    },
  };
};
