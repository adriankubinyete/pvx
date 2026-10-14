import type { Registry, RegisteredPage } from "@pvx/core";
import { clean } from "../palette/search.ts";
import type { TabId } from "./context.ts";

export interface PageTab {
  id: TabId;
  label: string;
  page: RegisteredPage;
}

/** Tabs the modules contribute, after the core ones: by `order`, then label. Empty when no module is loaded. Pages of `hidden` modules (a user preference) are skipped. */
export function pageTabs(registry: Pick<Registry, "pages">, hidden?: ReadonlySet<string>): PageTab[] {
  return [...registry.pages.values()]
    .flatMap((page) => {
      if (!page.tab || hidden?.has(page.moduleId)) return [];
      const t = page.tab === true ? { label: page.title, order: 0 } : { label: page.tab.label, order: page.tab.order ?? 0 };
      return [{ id: `page:${page.key}` as TabId, label: clean(t.label), order: t.order, page }];
    })
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map(({ id, label, page }) => ({ id, label, page }));
}

/** The first tab a module contributes, hidden or not. */
export const tabOf = (registry: Pick<Registry, "pages">, moduleId: string): PageTab | undefined =>
  pageTabs(registry).find((t) => t.page.moduleId === moduleId);
