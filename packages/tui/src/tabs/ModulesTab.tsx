import { useMemo, useState } from "react";
import type { Registry } from "@pvx/core";
import { ItemList, LABEL_W } from "../menu/ItemList.tsx";
import { buildRoot, type Item } from "../menu/tree.ts";
import { useLayout } from "../layout.ts";
import { useRouter } from "../router.tsx";
import { LogScreen } from "../session/LogScreen.tsx";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";

/** The Módulos tab: every module with its state. A failed one shows its error and enter opens its log. */
export function ModulesTab({ registry, nav }: { registry: Registry; nav: { modulesSel?: string } }) {
  const router = useRouter();
  const tabs = useTabs();
  const { cols } = useLayout();
  const { g } = useTheme();
  const [sel, setSel] = useState(nav.modulesSel);
  nav.modulesSel = sel;
  const items = useMemo(() => buildRoot(registry).map((i): Item =>
    i.errorOf ? i : { ...i, help: `${registry.modules.get(i.label)?.version ?? ""} carregado · ${i.help}` }), [registry]);
  return (
    <ItemList items={items} sel={sel} focused={tabs?.focused ?? true} onTop={tabs?.focusBar} title={`${g.query} módulos`} helpW={cols - 2 - 4 - LABEL_W - 2}
      onSel={setSel}
      onActivate={(i) => { if (i.errorOf) router.push({ id: "log", element: <LogScreen moduleId={i.errorOf} /> }); }} />
  );
}
