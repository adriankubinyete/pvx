import { useMemo, useReducer, useRef, useState } from "react";
import type { Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { createMenuNav, Menu, type MenuNav } from "../menu/Menu.tsx";
import { useLayout } from "../layout.ts";
import { useScreenScope } from "../router.tsx";
import { usePages } from "../sdk-ui/host.tsx";
import { PagePane, pageScope } from "../sdk-ui/index.tsx";
import { Session } from "../session/Session.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { TAB_IDS, TabsProvider, type CoreTabId, type TabId } from "./context.ts";
import { CoreTab, type CoreCache } from "./CoreTab.tsx";
import { fitBar } from "./bar.ts";
import { createHomeNav, HomeTab, type HomeNav } from "./HomeTab.tsx";
import { pageTabs } from "./pageTabs.ts";

const LABELS: Record<CoreTabId, string> = { inicio: "Início", modulos: "Módulos", conformidade: "Conformidade", plano: "Plano", logs: "Logs", comando: "Comando" };
/** Tabs that show a core command's output (the id is also the command). */
const CORE: readonly TabId[] = ["conformidade", "plano", "logs"];

/** Which tab is open and who has the keyboard. Outside the components: the active tab is the only one mounted. */
export interface TabsNav {
  active: TabId;
  /** True while the tab bar has the keyboard. */
  bar: boolean;
  /** First tab shown when the bar overflows. */
  barFrom: number;
  /** Módulos: the module menu. */
  menu: MenuNav;
  home: HomeNav;
  /** Last result of each core tab: memory only, for the TUI session. */
  core: CoreCache;
  /** Comando input draft: memory only (a secret never goes in the line; it goes through the modal). */
  draft: string;
}
export const createTabsNav = (): TabsNav => ({ active: "inicio", bar: false, barFrom: 0, menu: createMenuNav(), home: createHomeNav(), core: {}, draft: "" });

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

interface BarTab {
  id: TabId;
  label: string;
  errors: number;
}

function TabBar({ nav, tabs, active, version, onPick }: { nav: TabsNav; tabs: BarTab[]; active: TabId; version: string; onPick: (id: TabId) => void }) {
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const tag = `pvx ${version} `;
  const widths = tabs.map((t) => [...t.label].length + 2 + (t.errors ? ` ${g.error}${t.errors}`.length : 0));
  const { from, to } = fitBar(widths, tabs.findIndex((t) => t.id === active), nav.barFrom, cols - 2 - tag.length);
  nav.barFrom = from;
  return (
    <box height={1} flexShrink={0} overflow="hidden" flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" flexShrink={0}>
        {from > 0 ? <text fg={c.dim} flexShrink={0}>{g.moreLeft}</text> : null}
        {tabs.slice(from, to).map((t) => (
          <Tab key={t.id} label={t.label} errors={t.errors} active={t.id === active} focused={nav.bar} onPick={() => onPick(t.id)} />
        ))}
        {to < tabs.length ? <text fg={c.dim} flexShrink={0}>{g.moreRight}</text> : null}
      </box>
      <text fg={c.dim} wrapMode="none" flexShrink={0}>{tag}</text>
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
  const hasPages = usePages() !== null; // module tabs need the page host
  const modTabs = useMemo(() => (hasPages ? pageTabs(registry) : []), [hasPages, registry]);
  const ids: TabId[] = [...TAB_IDS, ...modTabs.map((t) => t.id)];
  const active = ids.includes(nav.active) ? nav.active : "inicio"; // the module went away
  const pageTab = modTabs.find((t) => t.id === active);
  // A visited module tab stays mounted (hidden) so its state survives a switch; it lives while this screen does.
  const visited = useRef(new Set<TabId>());
  if (pageTab) visited.current.add(active);
  // A tab with nothing to select never holds focus.
  const hasSel = (id: TabId) => id === "inicio" || id === "comando" || id.startsWith("page:") || (id === "modulos" && registry.modules.size + registry.errors.length > 0);
  const step = (d: number) => {
    const id = ids[(ids.indexOf(active) + d + ids.length) % ids.length]!;
    update({ active: id, bar: true }); // switching never auto-focuses the content: down goes in
  };
  useScreenScope(nav.bar ? "tabs" : pageTab ? pageScope(pageTab.page) : active === "comando" ? "session" : active === "inicio" ? "home" : "menu", nav.bar ? 2 : 0); // the bar outranks any view inside a tab
  useKeys((k) => {
    if (matchKey(k, "tab")) return step(1), true;
    if (matchKey(k, "shift+tab")) return step(-1), true;
    if (!nav.bar) return;
    if (k.name === "left" || k.name === "right") return step(k.name === "left" ? -1 : 1), true;
    if (k.name === "down" || matchKey(k, "enter")) return hasSel(active) && update({ bar: false }), true;
  }, { base: true });

  const api = { focused: !nav.bar, focusBar: () => update({ bar: true }), goto: (id: TabId) => update({ active: id, bar: false }) };
  const bar: BarTab[] = [
    ...TAB_IDS.map((id) => ({ id, label: LABELS[id], errors: id === "modulos" ? registry.errors.length : 0 })),
    ...modTabs.map((t) => ({ id: t.id, label: t.label, errors: 0 })),
  ];
  return (
    <TabsProvider value={api}>
      <box flexGrow={1} minHeight={0} flexDirection="column">
        <TabBar nav={nav} tabs={bar} active={active} version={version} onPick={(id) => update({ active: id, bar: true })} />
        <box flexGrow={1} minHeight={0} flexDirection="column">
          {active === "inicio" ? <HomeTab store={store} nav={nav} profile={profile} slots={registry.slots} /> : null}
          {active === "modulos" ? <Menu store={store} registry={registry} nav={nav.menu} /> : null}
          {CORE.includes(active) ? <CoreTab key={active} store={store} line={active} cache={nav.core} /> : null}
          {active === "comando" ? <Session store={store} registry={registry} draft={nav} /> : null}
          {modTabs.filter((t) => visited.current.has(t.id)).map((t) => (
            <box key={t.id} flexGrow={t.id === active ? 1 : 0} minHeight={0} flexDirection="column" visible={t.id === active}>
              <PagePane page={t.page} active={t.id === active} />
            </box>
          ))}
        </box>
      </box>
    </TabsProvider>
  );
}
