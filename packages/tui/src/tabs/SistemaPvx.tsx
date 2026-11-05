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

/** Cells of the cursor column and of the gap between the buttons. */
const CURSOR_W = 2;
const STATUS_GAP_W = 2;
/** The buttons of the actions row. */
export const UPDATE_BUTTONS = ["update", "verify", "uninstall"] as const;
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
  /** Asks first (it removes pvx from the system), then runs `uninstall` through the session. */
  uninstall(): Promise<void>;
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
  async function uninstall() {
    if (binary === null) {
      nudge("rodando pelo código-fonte: não há binário para desinstalar");
      return;
    }
    const sure = await store.confirm({ title: "desinstalar o pvx?", description: "remove o binário e o banner de login; os dados em PVX_HOME ficam", confirmLabel: "desinstalar", cancelLabel: "manter", destructive: true });
    if (!sure) return;
    void store.run(UNINSTALL_COMMAND);
    tabs?.goto("comando");
  }
  return { facts, check, blocker, verify, update, uninstall };
}

/** A line that only says something: no cursor, no hover, not selectable. `color` overrides the value color (the update status takes its tone). */
function Info({ row, width, dim, color }: { row: InfoRow; width: number; dim?: boolean; color?: string }) {
  const { c } = useTheme();
  return (
    <text wrapMode="none" flexShrink={0} selectable={false}>
      <span>{" ".repeat(CURSOR_W)}</span>
      <span fg={c.dim}>{row.label.padEnd(SETTING_LABEL_W)}</span>
      <span fg={color ?? (dim ? c.dim : c.text)}>{fit(row.value, width - CURSOR_W - SETTING_LABEL_W)}</span>
    </text>
  );
}

/** What the update check says: `sem binário`, `atualizado`, `consultando…` and so on, in its tone. */
function UpdateInfo({ state, width }: { state: UpdateCheck; width: number }) {
  const { c } = useTheme();
  const status = updateStatus(state.check, state.blocker);
  const text = state.check.status === "loading" ? "consultando…" : status.text;
  return <Info row={{ label: "atualização", value: text }} width={width} color={toneColor(c, status.tone)} />;
}

/** The pvx section: the lines that only say something, then `actions` (the one row with the cursor, the buttons). */
export function PvxInfo({ state, width, actions }: { state: UpdateCheck; width: number; actions: React.ReactNode }) {
  const rows = pvxInfoRows(state.facts);
  return (
    <>
      <Info row={rows.version} width={width} />
      <UpdateInfo state={state} width={width} />
      <Info row={rows.platform} width={width} />
      <Info row={rows.data} width={width} />
      {rows.embedded ? <Info row={rows.embedded} width={width} /> : null}
      {actions}
    </>
  );
}

/** `[ atualizar ]` and `[ verificar ]`; `current` is the button the keyboard is on. */
export function UpdateButtons({ state, current, onPress }: { state: UpdateCheck; current?: UpdateButton; onPress: (button: UpdateButton) => void }) {
  return (
    <box flexDirection="row" columnGap={STATUS_GAP_W} flexShrink={0}>
      <Button label="atualizar" primary disabled={state.blocker === undefined ? undefined : ""} focused={current === "update"} onPress={() => onPress("update")} />
      <Button label="verificar" focused={current === "verify"} onPress={() => onPress("verify")} />
      <Button label="desinstalar" focused={current === "uninstall"} disabled={state.facts.binary === null ? "" : undefined} onPress={() => onPress("uninstall")} />
    </box>
  );
}
