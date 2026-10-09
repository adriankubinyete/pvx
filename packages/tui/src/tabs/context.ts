import { createContext, useContext } from "react";

export const TAB_IDS = ["inicio", "modulos", "conformidade", "plano", "logs", "comando"] as const;
export type TabId = (typeof TAB_IDS)[number];

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
