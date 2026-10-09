import { useMemo, useState, useSyncExternalStore } from "react";
import type { Registry } from "@pvx/core";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useRouter } from "../router.tsx";
import { LogScreen } from "../session/LogScreen.tsx";
import { SessionModals } from "../session/Modals.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTabs } from "../tabs/context.ts";
import { useTheme } from "../theme-context.tsx";
import { ItemList, LABEL_W } from "./ItemList.tsx";
import { MenuForm } from "./MenuForm.tsx";
import { Result } from "./Result.tsx";
import { buildRoot, crumbs, itemsAt, type Item } from "./tree.ts";

/** Where the user is. Lives outside the component: the router unmounts the menu while another screen is on top. */
export interface MenuNav {
  path: string[];
  sel: Record<string, string>;
}
export const createMenuNav = (): MenuNav => ({ path: [], sel: {} });

type View = { kind: "list" } | { kind: "form"; item: Item } | { kind: "result"; id: number };

/** The Módulos tab: the registry as a menu (modules, then command groups, then the form and the result). Arrows and enter; esc goes up; `/` goes to the Comando tab. */
export function Menu({ store, registry, nav }: { store: SessionApi; registry: Registry; nav: MenuNav }) {
  const router = useRouter();
  const { g } = useTheme();
  const tabs = useTabs();
  const { cols } = useLayout();
  const { pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [path, setPath] = useState(nav.path);
  const [sel, setSel] = useState(nav.sel);
  const [view, setView] = useState<View>({ kind: "list" });
  nav.path = path;
  nav.sel = sel;

  const root = useMemo(() => buildRoot(registry), [registry]);
  const items = itemsAt(root, path);
  const level = path.join("/");

  const runLine = (line: string, secrets?: Record<string, string>) => {
    void store.run(line, { secrets });
    setView({ kind: "result", id: store.blocks.at(-1)!.id }); // run adds its block synchronously
  };
  const activate = (item: Item) => {
    if (item.children) setPath([...path, item.id]);
    else if (item.errorOf) router.push({ id: "log", element: <LogScreen moduleId={item.errorOf} /> });
    else if (item.args?.length) setView({ kind: "form", item });
    else runLine(item.line!);
  };
  const select = (id: string) => setSel((s) => (s[level] === id ? s : { ...s, [level]: id }));

  useKeys((k) => {
    if (view.kind !== "list" || tabs?.focused === false) return;
    if (k.name === "escape" && path.length) return setPath(path.slice(0, -1)), true;
    if (k.sequence === "/") return tabs?.goto("comando"), true;
  });

  const back = () => setView({ kind: "list" });
  const helpW = cols - 2 - 4 - LABEL_W - 2;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {view.kind === "form" ? <MenuForm item={view.item} onRun={runLine} onBack={back} /> : null}
      {view.kind === "result" ? <Result store={store} id={view.id} onBack={back} /> : null}
      {view.kind === "list" ? (
        <ItemList items={items} sel={sel[level]} onSel={select} onActivate={activate} onTop={tabs?.focusBar} focused={tabs?.focused ?? true}
          title={`${g.query} ${["módulos", ...crumbs(root, path)].join(" › ")}`} helpW={helpW} />
      ) : null}
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}
