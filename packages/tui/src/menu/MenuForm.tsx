import { useScreenScope } from "../router.tsx";
import { CommandForm } from "../sdk-ui/command-form.tsx";
import { Crumb } from "./Crumb.tsx";
import type { Item } from "./tree.ts";

/** Form of a command with args, as in a module page: the crumb, then `CommandForm` (secrets never reach the CLI line). Owns only its own keys. */
export function MenuForm({ item, onRun, onBack }: { item: Item; onRun: (line: string, secrets: Record<string, string>) => void; onBack: () => void }) {
  useScreenScope("form", 1);
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1} overflow="hidden">
      <Crumb parts={["módulos", item.label]} />
      <CommandForm line={item.line!} args={item.args!} title={item.title ?? item.help} onRun={onRun} onCancel={onBack} />
    </box>
  );
}
