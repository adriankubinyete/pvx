/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The page: the greeted names and a button. The greeting is the module's own command (useCommand), so it lands in the scrollback and the audit.
import type { SdkUi } from "@pvx/sdk";
import { greetedNames } from "../state.ts";
import { FIX, TEXT } from "../texts.ts";
import { historyRows, rowIds } from "./rows.ts";

export const makePainel = ({ h, Panel, List, Text, Button, Loading, useState, useStore, useKey, useCommand, usePanels, usePageFocused }: SdkUi) =>
  function Painel() {
    const store = useStore();
    const panels = usePanels();
    const focused = usePageFocused();
    const greet = useCommand(FIX.greet);
    const [revision, setRevision] = useState(0);
    const [selected, setSelected] = useState<string | undefined>(undefined);
    const rows = historyRows(greetedNames(store));
    const ids = rowIds(rows);
    const selectedId = ids.find((id) => id === selected) ?? ids[0];

    const move = (delta: number) => setSelected(ids[panels.wrap(ids.indexOf(selectedId ?? ""), delta, ids.length)]);
    useKey("↑", "sobe", () => move(-1));
    useKey("↓", "desce", () => move(1));
    const greetWorld = async () => {
      await greet.run();
      setRevision(revision + 1);
    };

    if (greet.running) return <Loading label={TEXT.greeting} />;
    return (
      <Panel>
        <Button label={TEXT.greetButton} primary keys="s" onPress={() => void greetWorld()} />
        <Panel title={TEXT.historyTitle} tone={focused ? "accent" : undefined} panelRef={panels.ref("historico")}>
          {rows.length ? <List items={rows} selected={selectedId} /> : <Text tone="dim">{TEXT.historyEmpty}</Text>}
        </Panel>
      </Panel>
    );
  };
