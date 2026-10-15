import { hooks } from "./host.tsx";
import { Button } from "./button.tsx";
import { Panel, Row, Spacer, Text } from "./kit.tsx";
import { resultViewOf } from "./command-result.ts";
import type { SdkUi } from "@pvx/sdk";

type CommandResultProps = Parameters<SdkUi["CommandResult"]>[0];

/** Columns between two buttons. */
const BUTTON_GAP = 2;

/**
 * A command result: the section (`Erro` or `Concluído`, the message lines, then the dim details), ONE blank row, then `[ fechar ]`
 * and the page's own actions (UI.md, sections 8 and 12). `esc` and `enter` close it.
 */
export function CommandResult({ run, failure, actions = [], onClose }: CommandResultProps) {
  hooks.useBack(onClose);
  const view = resultViewOf(run, failure);
  return (
    <Panel>
      <Panel title={view.title} tone={view.tone}>
        {view.lines.map((line, index) => <Text key={index} tone={line.tone}>{line.text}</Text>)}
        {view.details.map((line, index) => <Text key={`d${index}`} tone="dim">{line}</Text>)}
      </Panel>
      <Spacer />
      <Row fit gap={BUTTON_GAP}>
        <Button label="fechar" primary keys="enter" onPress={onClose} />
        {actions.map((action) => <Button key={action.label} label={action.label} keys={action.keys} onPress={action.onPress} danger={action.danger} />)}
      </Row>
    </Panel>
  );
}
