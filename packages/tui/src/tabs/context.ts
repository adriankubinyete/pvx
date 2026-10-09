import { createContext, useContext } from "react";

/** Core tabs before the module tabs, and after them: Comando stays last, as the terminal tab. */
export const LEAD_TABS = ["inicio", "modulos"] as const;
export const TRAIL_TABS = ["logs", "comando"] as const;
export const TAB_IDS = [...LEAD_TABS, ...TRAIL_TABS] as const;
export type CoreTabId = (typeof TAB_IDS)[number];
/** A core tab, or `page:<module>.<page>` for a tab a module contributes. */
export type TabId = CoreTabId | `page:${string}`;

export interface TabsApi {
  /** True when the tab content owns the keyboard; false while the tab bar is focused. */
  focused: boolean;
  focusBar(): void;
  /** Switches tab and focuses its content. */
  goto(id: TabId): void;
}

const Ctx = createContext<TabsApi | null>(null);
export const TabsProvider = Ctx.Provider;
/** Null outside the tabs (a screen mounted alone): content then owns the keyboard. */
export const useTabs = () => useContext(Ctx);

const requests = new Set<(id: TabId) => void>();
/** The tab host listens here, so the palette (outside the tabs) can switch tab. False when no tabs are mounted. */
export const onTabRequest = (fn: (id: TabId) => void) => (requests.add(fn), () => void requests.delete(fn));
export const requestTab = (id: TabId) => (requests.forEach((f) => f(id)), requests.size > 0);
