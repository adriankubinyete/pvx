import { hooks } from "./host.tsx";
import { ButtonRow } from "./button.tsx";
import { Panel, Spacer, Text } from "./kit.tsx";
import { resultViewOf } from "./command-result.ts";
import type { SdkUi } from "@pvx/sdk";

type CommandResultProps = Parameters<SdkUi["CommandResult"]>[0];

/**
 * A command result: the section (`Erro` or `Concluído`, the message lines, then the dim details), ONE blank row, then `[ fechar ]`
 * and the page's own actions as one focused `ButtonRow` (UI.md, sections 8, 12 and 17). `esc` closes it; `enter` presses the current button, `fechar` first.
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
      <ButtonRow focused buttons={[{ label: "fechar", primary: true, onPress: onClose }, ...actions]} />
    </Panel>
  );
}
