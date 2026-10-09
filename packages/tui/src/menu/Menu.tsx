import { hostname } from "node:os";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Registry } from "@pvx/core";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { clean } from "../palette/search.ts";
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

const PANEL_W = 34;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

function SidePanel({ registry, history, version }: { registry: Registry; history: readonly string[]; version: string }) {
  const { c, box, g } = useTheme();
  const n = registry.modules.size;
  return (
    <box width={PANEL_W} flexShrink={0} flexDirection="column" paddingX={1} {...box()} title={`${g.query} central`}>
      <text fg={c.text}>{clean(hostname())}</text>
      <text fg={c.dim}>{`pvx ${version}`}</text>
      <text fg={c.dim}>{`${n} ${n === 1 ? "módulo" : "módulos"}`}</text>
      {registry.errors.length ? <text fg={c.error}>{`${g.error} ${registry.errors.length} com erro`}</text> : null}
      <text fg={c.dim}>{" "}</text>
      <text fg={c.dim}>últimos comandos</text>
      {history.slice(-5).reverse().map((l, i) => <text key={i} fg={c.text}>{cut(clean(l), PANEL_W - 4)}</text>)}
    </box>
  );
}

type View = { kind: "list" } | { kind: "form"; item: Item } | { kind: "result"; id: number };

/** The Início tab: lists generated from the registry (modules, then command groups). Arrows and enter; `/` goes to the Comando tab. */
export function Menu({ store, registry, nav, version }: { store: SessionApi; registry: Registry; nav: MenuNav; version: string }) {
  const router = useRouter();
  const { g } = useTheme();
  const tabs = useTabs();
  const { cols, narrow } = useLayout();
  const { history, pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
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
  const helpW = cols - 2 - (narrow ? 0 : PANEL_W) - 4 - LABEL_W - 2;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {view.kind === "form" ? <MenuForm item={view.item} onRun={runLine} onBack={back} /> : null}
      {view.kind === "result" ? <Result store={store} id={view.id} onBack={back} /> : null}
      {view.kind === "list" ? (
        <ItemList items={items} sel={sel[level]} onSel={select} onActivate={activate} onTop={tabs?.focusBar} focused={tabs?.focused ?? true}
          title={`${g.query} ${["início", ...crumbs(root, path)].join(" › ")}`} helpW={helpW} />
      ) : null}
      {narrow ? null : <SidePanel registry={registry} history={history} version={version} />}
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}
