import { useReducer, useState } from "react";
import type { Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { createMenuNav, Menu, type MenuNav } from "../menu/Menu.tsx";
import { useScreenScope } from "../router.tsx";
import { Session } from "../session/Session.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { TAB_IDS, TabsProvider, type TabId } from "./context.ts";
import { CoreTab, type CoreCache } from "./CoreTab.tsx";
import { createHomeNav, HomeTab, type HomeNav } from "./HomeTab.tsx";

const LABELS: Record<TabId, string> = { inicio: "Início", modulos: "Módulos", conformidade: "Conformidade", plano: "Plano", logs: "Logs", comando: "Comando" };
/** Tabs that show a core command's output (the id is also the command). */
const CORE: readonly TabId[] = ["conformidade", "plano", "logs"];

/** Which tab is open and who has the keyboard. Outside the components: the active tab is the only one mounted. */
export interface TabsNav {
  active: TabId;
  /** True while the tab bar has the keyboard. */
  bar: boolean;
  /** Módulos: the module menu. */
  menu: MenuNav;
  home: HomeNav;
  /** Last result of each core tab: memory only, for the TUI session. */
  core: CoreCache;
  /** Comando input draft: memory only (a secret never goes in the line; it goes through the modal). */
  draft: string;
}
export const createTabsNav = (): TabsNav => ({ active: "inicio", bar: false, menu: createMenuNav(), home: createHomeNav(), core: {}, draft: "" });

function Tab({ label, errors, active, focused, onPick }: { label: string; errors: number; active: boolean; focused: boolean; onPick: () => void }) {
  const { c, g } = useTheme();
  const [hover, setHover] = useState(false);
  const bg = active ? (focused ? c.selected : c.panel) : hover ? c.panel : undefined;
  return (
    <box backgroundColor={bg} paddingX={1} flexShrink={0} onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)} onMouseDown={onPick}>
      <text>
        <span fg={active ? (focused ? c.accent : c.text) : c.dim}>{active ? <b><u>{label}</u></b> : label}</span>
        {errors ? <span fg={c.error}>{` ${g.error}${errors}`}</span> : null}
      </text>
    </box>
  );
}

function TabBar({ nav, errors, version, onPick }: { nav: TabsNav; errors: number; version: string; onPick: (id: TabId) => void }) {
  const { c } = useTheme();
  return (
    <box height={1} flexShrink={0} overflow="hidden" flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" flexShrink={0}>
        {TAB_IDS.map((id) => (
          <Tab key={id} label={LABELS[id]} errors={id === "modulos" ? errors : 0} active={id === nav.active} focused={nav.bar} onPick={() => onPick(id)} />
        ))}
      </box>
      <text fg={c.dim} wrapMode="none" flexShrink={0}>{`pvx ${version} `}</text>
    </box>
  );
}

/**
 * Root screen: the tab bar plus the active tab. Keys: tab/shift+tab switch from anywhere (the Comando input keeps `tab`
 * for completing); with the bar focused, left/right switch and down enters the tab. The tab handler is `base`, so
 * content that consumes a key (a form's `tab`) wins.
 */
export function Tabs({ store, registry, nav, version, profile }: { store: SessionApi; registry: Registry; nav: TabsNav; version: string; profile?: string | null }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const update = (p: Partial<TabsNav>) => (Object.assign(nav, p), bump());
  // A tab with nothing to select never holds focus.
  const hasSel = (id: TabId) => id === "inicio" || id === "comando" || (id === "modulos" && registry.modules.size + registry.errors.length > 0);
  const step = (d: number) => {
    const id = TAB_IDS[(TAB_IDS.indexOf(nav.active) + d + TAB_IDS.length) % TAB_IDS.length]!;
    update({ active: id, bar: true }); // switching never auto-focuses the content: down goes in
  };
  useScreenScope(nav.bar ? "tabs" : nav.active === "comando" ? "session" : nav.active === "inicio" ? "home" : "menu", nav.bar ? 2 : 0); // the bar outranks any view inside a tab
  useKeys((k) => {
    if (matchKey(k, "tab")) return step(1), true;
    if (matchKey(k, "shift+tab")) return step(-1), true;
    if (!nav.bar) return;
    if (k.name === "left" || k.name === "right") return step(k.name === "left" ? -1 : 1), true;
    if (k.name === "down" || matchKey(k, "enter")) return hasSel(nav.active) && update({ bar: false }), true;
  }, { base: true });

  const api = { focused: !nav.bar, focusBar: () => update({ bar: true }), goto: (id: TabId) => update({ active: id, bar: false }) };
  return (
    <TabsProvider value={api}>
      <box flexGrow={1} minHeight={0} flexDirection="column">
        <TabBar nav={nav} errors={registry.errors.length} version={version} onPick={(id) => update({ active: id, bar: true })} />
        <box flexGrow={1} minHeight={0} flexDirection="column">
          {nav.active === "inicio" ? <HomeTab store={store} nav={nav} profile={profile} /> : null}
          {nav.active === "modulos" ? <Menu store={store} registry={registry} nav={nav.menu} /> : null}
          {CORE.includes(nav.active) ? <CoreTab key={nav.active} store={store} line={nav.active} cache={nav.core} /> : null}
          {nav.active === "comando" ? <Session store={store} registry={registry} draft={nav} /> : null}
        </box>
      </box>
    </TabsProvider>
  );
}
