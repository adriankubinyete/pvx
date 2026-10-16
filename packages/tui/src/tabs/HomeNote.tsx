import type { Registry } from "@pvx/core";
import { Crumb } from "../menu/Crumb.tsx";
import { useNudge, type NudgeTone } from "../nudge.tsx";
import { clean } from "../palette/search.ts";
import { CommandForm } from "../sdk-ui/command-form.tsx";
import type { Block, SessionApi } from "../session/store.ts";

const CRUMB = ["Início", "nova nota"];
const SUBMIT_LABEL = "salvar nota";
const CREATED_TEXT = "nota criada";
const REMOVED_TEXT = "nota removida";
const CANCELLED_TEXT = "cancelado";

/** What to tell the technician after a command of the notes ran: a `✓` on success, the cause on failure, nothing when they declined the question. */
export function outcomeOfRun(block: Block | undefined, exit: number, success = REMOVED_TEXT): { text: string; tone: NudgeTone } | undefined {
  if (exit === 0) return { text: success, tone: "ok" };
  const lines = block?.lines ?? [];
  if (lines.some((line) => line.kind === "warning" && line.text === CANCELLED_TEXT)) return undefined;
  const cause = lines.find((line) => line.kind === "error")?.text ?? "a nota não foi salva";
  return { text: clean(cause), tone: "error" };
}

interface ComposerProps {
  store: SessionApi;
  registry: Registry;
  /** The command of the `addNote` role: its `args` are the fields of the form. */
  line: string;
  onClose: () => void;
  onSaved: () => void;
}

/** The `+ nova nota` form: the fields of the `addNote` command in the standard form, in place of Início. Saves through the session, so the scrollback and the root rule apply. */
export function NoteComposer({ store, registry, line, onClose, onSaved }: ComposerProps) {
  const nudge = useNudge();
  const command = registry.commands.get(line)!;
  const save = async (built: string, secrets: Record<string, string>) => {
    const { exit } = await store.run(built, { secrets });
    const outcome = outcomeOfRun(store.blocks.at(-1), exit, CREATED_TEXT);
    if (outcome) nudge(outcome.text, outcome.tone);
    if (exit !== 0) return;
    onSaved();
    onClose();
  };
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1} overflow="hidden">
      <Crumb parts={CRUMB} />
      <CommandForm line={line} args={command.args ?? []} title={command.title ?? command.help} submitLabel={SUBMIT_LABEL} onRun={save} onCancel={onClose} />
    </box>
  );
}
