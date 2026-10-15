import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { type MachineSampler, type Pending, type Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { createMenuNav, Menu, type MenuNav } from "../menu/Menu.tsx";
import { defaultPending, ModulesProvider, useRegistryRev, type ModulesDeps } from "../modules/deps.ts";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { useScreenScope } from "../router.tsx";
import { usePages } from "../sdk-ui/host.tsx";
import { PagePane, pageScope } from "../sdk-ui/index.tsx";
import { Session } from "../session/Session.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { LEAD_TABS, onTabRequest, TRAIL_TABS, TabsProvider, type CoreTabId, type TabId } from "./context.ts";
import { SistemaTab } from "./SistemaTab.tsx";
import { CoreTab, type CoreCache } from "./CoreTab.tsx";
import { barVersion, fitBar } from "./bar.ts";
import { Clock, clockCost, pickForm } from "./clock.tsx";
import { createHomeNav, HomeTab, type HomeNav } from "./HomeTab.tsx";
import { pageTabs } from "./pageTabs.ts";

const LABELS: Record<CoreTabId, string> = { inicio: "Início", modulos: "Módulos", logs: "Logs", comando: "Comando", sistema: "Sistema" };
/** Tabs that show a core command's output (the id is also the command). */
const CORE: readonly TabId[] = ["logs"];

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
  /** Last result of each core command tab (Logs): memory only, for the TUI session. */
  core: CoreCache;
  /** Comando input draft: memory only (a secret never goes in the line; it goes through the modal). */
  draft: string;
  /** Modules with commits upstream (background check, memory only). */
  updates: Pending[];
}
export const createTabsNav = (): TabsNav => ({ active: "inicio", bar: false, barFrom: 0, menu: createMenuNav(), home: createHomeNav(), core: {}, draft: "", updates: [] });

function Tab({ label, errors, behind, active, focused, onPick }: { label: string; errors: number; behind: number; active: boolean; focused: boolean; onPick: () => void }) {
  const { c, g } = useTheme();
  const [hover, setHover] = useState(false);
  const bg = active ? (focused ? c.selected : c.panel) : hover ? c.panel : undefined;
  return (
    <box backgroundColor={bg} paddingX={1} flexShrink={0} onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)} onMouseDown={onPick}>
      <text>
        <span fg={active ? (focused ? c.accent : c.text) : c.dim}>{active ? <b><u>{label}</u></b> : label}</span>
        {errors ? <span fg={c.error}>{` ${g.error}${errors}`}</span> : null}
        {behind ? <span fg={c.info}>{` ↓${behind}`}</span> : null}
      </text>
    </box>
  );
}

interface BarTab {
  id: TabId;
  label: string;
  errors: number;
  /** Modules with updates waiting (the `↓n` mark). */
  behind: number;
}

/** Columns of the separator between the last tab and the clock and version: ` │ `. */
const BAR_SEPARATOR_W = 3;

function TabBar({ nav, tabs, active, version, now, onPick }: { nav: TabsNav; tabs: BarTab[]; active: TabId; version: string; now: () => number; onPick: (id: TabId) => void }) {
  const { c, g } = useTheme();
  const { cols } = useLayout();
  const tag = `pvx ${barVersion(version)} `;
  const widths = tabs.map((t) => [...t.label].length + 2 + (t.errors ? ` ${g.error}${t.errors}`.length : 0) + (t.behind ? ` ↓${t.behind}`.length : 0));
  // The tabs fit around the separator, the shortest clock (HH:MM) and the version; the clock then takes the richest form that fits in what is left.
  const reserve = tag.length + BAR_SEPARATOR_W + clockCost("short");
  const { from, to } = fitBar(widths, tabs.findIndex((t) => t.id === active), nav.barFrom, cols - 2 - reserve);
  nav.barFrom = from;
  const used = (from > 0 ? 1 : 0) + (to < tabs.length ? 1 : 0) + widths.slice(from, to).reduce((a, b) => a + b, 0);
  const form = pickForm(cols - 2 - used - tag.length - BAR_SEPARATOR_W);
  return (
    <box height={1} flexShrink={0} overflow="hidden" flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" flexShrink={0}>
        {from > 0 ? <text fg={c.dim} flexShrink={0}>{g.moreLeft}</text> : null}
        {tabs.slice(from, to).map((t) => (
          <Tab key={t.id} label={t.label} errors={t.errors} behind={t.behind} active={t.id === active} focused={nav.bar} onPick={() => onPick(t.id)} />
        ))}
        {to < tabs.length ? <text fg={c.dim} flexShrink={0}>{g.moreRight}</text> : null}
      </box>
      <box flexDirection="row" flexShrink={0}>
        <text fg={c.border} wrapMode="none" flexShrink={0}>{` ${g.sepBar} `}</text>
        {form === "none" ? null : <Clock form={form} now={now} />}
        <text fg={c.dim} wrapMode="none" flexShrink={0}>{tag}</text>
      </box>
    </box>
  );
}

/** The thin line under the bar: it separates the bar from the page. */
function BarRule() {
  const { c, g } = useTheme();
  const { cols } = useLayout();
  return <text fg={c.border} wrapMode="none" flexShrink={0}>{g.hline.repeat(Math.max(0, cols - 2))}</text>;
}

/**
 * Root screen: the tab bar plus the active tab. Keys: tab/shift+tab switch from anywhere (the Comando input keeps `tab`
 * for completing); with the bar focused, left/right switch and down enters the tab. The tab handler is `base`, so
 * content that consumes a key (a form's `tab`) wins.
 */
export function Tabs({ store, registry, nav, version, profile, modules, now = Date.now, logsMs, sampler }: { store: SessionApi; registry: Registry; nav: TabsNav; version: string; profile?: string | null; modules?: ModulesDeps; now?: () => number; logsMs?: number; sampler?: MachineSampler }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const update = (p: Partial<TabsNav>) => (Object.assign(nav, p), bump());
  const nudge = useNudge();
  const hasPages = usePages() !== null; // module tabs need the page host
  const rev = useRegistryRev(registry); // add, trust, update, remove, disable and dev reloads change the tabs live
  const { axes } = useTheme();
  const hiddenTabs = useMemo(() => new Set(axes.hiddenTabs), [axes.hiddenTabs]);
  const modTabs = useMemo(() => (hasPages ? pageTabs(registry, hiddenTabs) : []), [hasPages, registry, rev, hiddenTabs]);
  // Update notice: in the background, never in the way of the first frame; interactive hosts only (they pass `modules`).
  useEffect(() => {
    if (!modules) return;
    let live = true;
    defaultPending(modules).then((p) => live && update({ updates: p }), () => {});
    return () => void (live = false);
  }, [modules, registry, rev]);
  const ids: TabId[] = [...LEAD_TABS, ...modTabs.map((t) => t.id), ...TRAIL_TABS];
  const hiddenNow = !ids.includes(nav.active) && hasPages && pageTabs(registry).some((t) => t.id === nav.active); // hidden by the user, not gone
  if (hiddenNow) nav.active = "modulos";
  const active = ids.includes(nav.active) ? nav.active : "inicio"; // the module went away
  const pageTab = modTabs.find((t) => t.id === active);
  // A visited module tab stays mounted (hidden) so its state survives a switch; it lives while this screen does.
  const visited = useRef(new Set<TabId>());
  if (pageTab) visited.current.add(active);
  // A tab with nothing to select never holds focus.
  const hasSel = (id: TabId) => id === "inicio" || id === "comando" || id === "sistema" || id.startsWith("page:") || (id === "modulos" && (Boolean(modules) || registry.modules.size + registry.errors.length > 0));
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
    if (k.name === "down" || matchKey(k, "enter")) return hasSel(active) ? update({ bar: false }) : nudge("nada aqui"), true;
    if (k.sequence === "/") return update({ active: "comando", bar: false }), true;
  }, { base: true });

  const api = { focused: !nav.bar, focusBar: () => update({ bar: true }), focusContent: () => nav.bar && hasSel(active) && update({ bar: false }), goto: (id: TabId) => update({ active: id, bar: false }) };
  useEffect(() => onTabRequest((id) => ids.includes(id) && api.goto(id)));
  const core = (id: CoreTabId) => ({ id, label: LABELS[id], errors: id === "modulos" ? registry.errors.length : 0, behind: id === "modulos" ? nav.updates.length : 0 });
  const bar: BarTab[] = [
    ...LEAD_TABS.map(core),
    ...modTabs.map((t) => ({ id: t.id, label: t.label, errors: 0, behind: 0 })),
    ...TRAIL_TABS.map(core),
  ];
  return (
    <ModulesProvider value={modules ?? null}>
    <TabsProvider value={api}>
      <box flexGrow={1} minHeight={0} flexDirection="column">
        <TabBar nav={nav} tabs={bar} active={active} version={version} now={now} onPick={(id) => update({ active: id, bar: true })} />
        <BarRule />
        {/* A mouse down anywhere in the content moves the keyboard in; it bubbles up after the clicked element has handled it. */}
        <box flexGrow={1} minHeight={0} flexDirection="column" onMouseDown={api.focusContent}>
          {active === "inicio" ? <HomeTab store={store} nav={nav} profile={profile} registry={registry} sampler={sampler} /> : null}
          {active === "modulos" ? <Menu store={store} registry={registry} nav={nav.menu} updates={nav.updates} /> : null}
          {CORE.includes(active) ? <CoreTab key={active} store={store} line={active} cache={nav.core} refreshMs={logsMs} /> : null}
          {active === "sistema" ? <SistemaTab store={store} registry={registry} version={version} /> : null}
          {active === "comando" ? <Session store={store} registry={registry} draft={nav} /> : null}
          {modTabs.filter((t) => visited.current.has(t.id)).map((t) => (
            <box key={t.id} flexGrow={t.id === active ? 1 : 0} minHeight={0} flexDirection="column" visible={t.id === active}>
              <PagePane page={t.page} active={t.id === active} />
            </box>
          ))}
        </box>
      </box>
    </TabsProvider>
    </ModulesProvider>
  );
}
