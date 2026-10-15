import { useState } from "react";
import { fetchLatestRelease, pvxHome, selfPath, SELF_UPDATE_COMMAND, UNINSTALL_COMMAND, type Registry } from "@pvx/core";
import { useNudge } from "../nudge.tsx";
import { Button } from "../sdk-ui/flow.tsx";
import type { SessionApi } from "../session/store.ts";
import { toneColor } from "../sdk-ui/tones.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { SETTING_LABEL_W } from "./SistemaRows.tsx";
import { fit, pvxInfoRows, updateBlocker, updateStatus, type InfoRow, type PvxFacts, type ReleaseCheck } from "./sistema.ts";

/** Cells the update row gives to what it says before its buttons: a fixed width, so the buttons stay where they are as the text changes. */
const STATUS_W = 27;
/** Cells of the cursor column and of the gap after the status. */
const CURSOR_W = 2;
const STATUS_GAP_W = 2;
/** The two buttons of the update row. */
export const UPDATE_BUTTONS = ["update", "verify"] as const;
export type UpdateButton = (typeof UPDATE_BUTTONS)[number];

/** What the section reads from the host. Running from source has no binary, and `selfPath` says so. */
function readFacts(registry: Registry, version: string, binary: string | null): PvxFacts {
  return { version, binary, home: pvxHome(), modules: registry.modules.size, embedded: [...registry.embedded.values()] };
}

export interface UpdateCheck {
  facts: PvxFacts;
  check: ReleaseCheck;
  blocker: string | undefined;
  verify(): Promise<void>;
  update(): void;
}

/** The state of the update: the release check and the two actions. `update` goes through the session (scrollback, log, audit and the root rule). */
export function useUpdateCheck(store: SessionApi, registry: Registry, version: string): UpdateCheck {
  const tabs = useTabs();
  const nudge = useNudge();
  const [check, setCheck] = useState<ReleaseCheck>({ status: "idle" });
  const [binary] = useState(() => selfPath(process.env)); // a real path lookup: once, not on every render
  const facts = readFacts(registry, version, binary);
  const blocker = updateBlocker(facts, check);

  async function verify() {
    if (check.status === "loading") return;
    setCheck({ status: "loading" });
    const latest = await fetchLatestRelease(process.env);
    setCheck(latest.ok ? { status: "done", available: latest.version } : { status: "error", message: latest.message });
    if (!latest.ok) nudge(latest.message, "error");
  }

  function update() {
    if (blocker) {
      nudge(blocker);
      return;
    }
    void store.run(SELF_UPDATE_COMMAND);
    tabs?.goto("comando");
  }
  return { facts, check, blocker, verify, update };
}

function Info({ row, width, dim }: { row: InfoRow; width: number; dim?: boolean }) {
  const { c } = useTheme();
  return (
    <text wrapMode="none" flexShrink={0}>
      <span>{" ".repeat(CURSOR_W)}</span>
      <span fg={c.dim}>{row.label.padEnd(SETTING_LABEL_W)}</span>
      <span fg={dim ? c.dim : c.text}>{fit(row.value, width - CURSOR_W - SETTING_LABEL_W)}</span>
    </text>
  );
}

/** The rows of the pvx section that only say something; `update` is the row between them that has buttons. */
export function PvxInfo({ facts, width, update }: { facts: PvxFacts; width: number; update: React.ReactNode }) {
  const rows = pvxInfoRows(facts);
  return (
    <>
      <Info row={rows.version} width={width} />
      {update}
      <Info row={rows.platform} width={width} />
      <Info row={rows.data} width={width} />
      {rows.embedded ? <Info row={rows.embedded} width={width} /> : null}
      <Info row={{ label: "desinstalar", value: `sudo pvx ${UNINSTALL_COMMAND}` }} width={width} dim />
    </>
  );
}

/** The status of the check, then `[ atualizar ]` and `[ verificar ]`; `current` is the button the keyboard is on. */
export function UpdateStatus({ state, current, onPress }: { state: UpdateCheck; current?: UpdateButton; onPress: (button: UpdateButton) => void }) {
  const { c } = useTheme();
  const status = updateStatus(state.check, state.blocker);
  const loading = state.check.status === "loading";
  return (
    <box flexDirection="row" flexShrink={0}>
      <text wrapMode="none" flexShrink={0} fg={toneColor(c, status.tone)}>{fit(loading ? "consultando…" : status.text, STATUS_W).padEnd(STATUS_W + STATUS_GAP_W)}</text>
      <box flexDirection="row" columnGap={STATUS_GAP_W} flexShrink={0}>
        <Button label="atualizar" primary disabled={state.blocker === undefined ? undefined : ""} focused={current === "update"} onPress={() => onPress("update")} />
        <Button label="verificar" focused={current === "verify"} onPress={() => onPress("verify")} />
      </box>
    </box>
  );
}
