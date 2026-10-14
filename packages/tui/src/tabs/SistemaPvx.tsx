import { useState } from "react";
import { catalogUrl, fetchLatestRelease, pvxHome, selfPath, SELF_UPDATE_COMMAND, UNINSTALL_COMMAND, usermodulesDir, type Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { useScreenScope } from "../router.tsx";
import { Button, Loading } from "../sdk-ui/flow.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { availableText, fit, plainVersion, pvxInfoRows, sectionOfKey, updateBlocker, type InfoRow, type PvxFacts, type ReleaseCheck, type Section } from "./sistema.ts";

const LABEL_W = 20;
/** Border (2) and padding (2) of the panel, plus the gap after the label. */
const CHROME_W = 6;
const ACTIONS = ["verificar", "atualizar"] as const;
type Action = (typeof ACTIONS)[number];

/** What the section reads from the host. Running from source has no binary, and `selfPath` says so. */
function readFacts(registry: Registry, version: string, binary: string | null): PvxFacts {
  return {
    version,
    binary,
    home: pvxHome(),
    usermodules: usermodulesDir(),
    catalog: catalogUrl(),
    modules: registry.modules.size,
  };
}

function Heading({ text }: { text: string }) {
  const { c } = useTheme();
  return <text wrapMode="none" fg={c.dim}>{text}</text>;
}

function Info({ row, width }: { row: InfoRow; width: number }) {
  const { c } = useTheme();
  return (
    <text wrapMode="none">
      <span fg={c.dim}>{row.label.padEnd(LABEL_W)}</span>
      <span fg={c.text}>{fit(row.value, width)}</span>
    </text>
  );
}

/** The "disponível" line: a spinner while the check runs. */
function Available({ check, width }: { check: ReleaseCheck; width: number }) {
  const { c } = useTheme();
  if (check.status === "loading") return <Loading label="consultando a última release…" />;
  const tone = check.status === "error" ? c.error : c.text;
  return (
    <text wrapMode="none">
      <span fg={c.dim}>{"disponível".padEnd(LABEL_W)}</span>
      <span fg={tone}>{fit(availableText(check), width)}</span>
    </text>
  );
}

/** The pvx section: about, update and the uninstall hint. Both actions are rows: `↑↓` and `enter`, or a click. */
export function PvxSection({ store, registry, version, onSection }: { store: SessionApi; registry: Registry; version: string; onSection: (section: Section) => void }) {
  const { c, box, g } = useTheme();
  const { cols } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const focused = tabs?.focused ?? true;
  const [selected, setSelected] = useState<Action>("verificar");
  const [check, setCheck] = useState<ReleaseCheck>({ status: "idle" });
  useScreenScope("sistemapvx", 1);
  const [binary] = useState(() => selfPath(process.env)); // a real path lookup: once, not on every render
  const facts = readFacts(registry, version, binary);
  const blocker = updateBlocker(facts, check);
  const valueWidth = cols - CHROME_W - LABEL_W;

  async function verify() {
    if (check.status === "loading") return;
    setCheck({ status: "loading" });
    const latest = await fetchLatestRelease(process.env);
    setCheck(latest.ok ? { status: "done", available: latest.version } : { status: "error", message: latest.message });
  }

  function update() {
    if (blocker) {
      nudge(blocker);
      return;
    }
    void store.run(SELF_UPDATE_COMMAND); // through the session: scrollback, log and audit, and the root rule
    tabs?.goto("comando");
  }

  const RUN: Record<Action, () => void> = { verificar: () => void verify(), atualizar: update };
  const press = (action: Action) => {
    setSelected(action);
    RUN[action]();
  };

  function move(delta: number) {
    const next = ACTIONS.indexOf(selected) + delta;
    if (next < 0) tabs?.focusBar();
    else if (next >= ACTIONS.length) nudge("fim da lista");
    else setSelected(ACTIONS[next]!);
  }

  useKeys((key) => {
    if (!focused) return;
    const section = sectionOfKey(key.sequence);
    if (section) return onSection(section), true;
    if (key.name === "up") return move(-1), true;
    if (key.name === "down") return move(1), true;
    if (matchKey(key, "enter")) return RUN[selected](), true;
    if (matchKey(key, "esc")) return tabs?.focusBar(), true;
  });

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1} overflow="hidden" {...box(focused ? c.accent : undefined)} title={`${g.query} pvx${focused ? ` ${g.active}` : ""}`}>
      <Heading text="sobre o pvx" />
      {pvxInfoRows(facts).map((row) => (
        <Info key={row.label} row={row} width={valueWidth} />
      ))}
      <text wrapMode="none"> </text>
      <Heading text="atualização" />
      <Info row={{ label: "instalada", value: plainVersion(version) }} width={valueWidth} />
      <Available check={check} width={valueWidth} />
      <Button label="verificar" onPress={() => press("verificar")} focused={focused && selected === "verificar"} />
      {blocker ? (
        <text wrapMode="none" fg={focused && selected === "atualizar" ? c.accent : c.dim} onMouseDown={() => press("atualizar")}>{`[ atualizar ] ${blocker}`}</text>
      ) : (
        <Button label="atualizar" primary onPress={() => press("atualizar")} focused={focused && selected === "atualizar"} />
      )}
      <text wrapMode="none"> </text>
      <Heading text="desinstalar" />
      <text wrapMode="none" fg={c.text}>{`pvx ${UNINSTALL_COMMAND}`}</text>
    </box>
  );
}
