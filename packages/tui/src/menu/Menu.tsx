import { hostname } from "node:os";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { clean } from "../palette/search.ts";
import { useRouter } from "../router.tsx";
import { LogScreen } from "../session/LogScreen.tsx";
import { SessionModals } from "../session/Modals.tsx";
import { Session } from "../session/Session.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { MenuForm } from "./MenuForm.tsx";
import { Result } from "./Result.tsx";
import { buildRoot, crumbs, itemsAt, type Item } from "./tree.ts";

/** Where the user is. Lives outside the component: the router unmounts the menu while another screen is on top. */
export interface MenuNav {
  path: string[];
  sel: Record<string, string>;
}
export const createMenuNav = (): MenuNav => ({ path: [], sel: {} });

const LABEL_W = 22;
const PANEL_W = 34;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

interface RowProps { item: Item; selected: boolean; helpW: number; onHover: (id: string) => void; onPick: (id: string) => void }

/** Memoized: moving the selection repaints two rows, not the list. */
const Row = memo(function Row({ item, selected, helpW, onHover, onPick }: RowProps) {
  const { c, g } = useTheme();
  return (
    <box id={item.id} flexDirection="row" flexShrink={0} paddingX={1} backgroundColor={selected ? c.selected : undefined}
      onMouseOver={() => onHover(item.id)} onMouseDown={() => onPick(item.id)}>
      <box width={LABEL_W} flexShrink={0}>
        <text>
          <span fg={c.accent}>{selected ? `${g.cursor} ` : "  "}</span>
          {item.errorOf ? <span fg={c.error}>{`${g.error} `}</span> : null}
          <span fg={item.errorOf ? c.error : c.text}>{cut(item.label, LABEL_W - 6)}</span>
          {item.destructive ? <span fg={c.error}>{" !"}</span> : null}
        </text>
      </box>
      <text fg={c.dim}>{cut(item.help, helpW)}</text>
    </box>
  );
});

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

/** The initial screen: lists generated from the registry (modules, command groups, core actions). Arrows and enter; `/` opens the command mode. */
export function Menu({ store, registry, nav, version }: { store: SessionApi; registry: Registry; nav: MenuNav; version: string }) {
  const { box } = useTheme();
  const router = useRouter();
  const { cols, narrow } = useLayout();
  const { history, pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [path, setPath] = useState(nav.path);
  const [sel, setSel] = useState(nav.sel);
  const [view, setView] = useState<View>({ kind: "list" });
  const scroll = useRef<ScrollBoxRenderable>(null);
  nav.path = path;
  nav.sel = sel;

  const root = useMemo(() => buildRoot(registry), [registry]);
  const items = itemsAt(root, path);
  const level = path.join("/");
  const cur = items.find((i) => i.id === sel[level]) ?? items[0];
  useEffect(() => {
    if (cur) scroll.current?.scrollChildIntoView(cur.id);
  }, [cur?.id, level]);

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

  // Mouse callbacks stay stable (rows are memoized) and read the latest state through the ref.
  const latest = useRef({ select, activate, items });
  latest.current = { select, activate, items };
  const hover = useCallback((id: string) => latest.current.select(id), []);
  const pick = useCallback((id: string) => {
    const l = latest.current;
    l.select(id);
    l.activate(l.items.find((i) => i.id === id)!);
  }, []);

  useKeys((k) => {
    if (view.kind !== "list") return;
    if (k.name === "up" || k.name === "down") {
      const i = items.findIndex((x) => x.id === cur?.id);
      return select(items[Math.max(0, Math.min(items.length - 1, i + (k.name === "up" ? -1 : 1)))]?.id ?? ""), true;
    }
    if (matchKey(k, "enter")) return cur && activate(cur), true;
    if (k.name === "escape" && path.length) return setPath(path.slice(0, -1)), true;
    if (k.sequence === "/") return router.push({ id: "sessao", element: <Session store={store} registry={registry} /> }), true;
  });

  const back = () => setView({ kind: "list" });
  const helpW = cols - 2 - (narrow ? 0 : PANEL_W) - 4 - LABEL_W - 2;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {view.kind === "form" ? <MenuForm item={view.item} onRun={runLine} onBack={back} /> : null}
      {view.kind === "result" ? <Result store={store} id={view.id} onBack={back} /> : null}
      {view.kind === "list" ? (
        <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={["início", ...crumbs(root, path)].join(" › ")}>
          <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
            {items.map((i) => <Row key={i.id} item={i} selected={i.id === cur?.id} helpW={helpW} onHover={hover} onPick={pick} />)}
          </scrollbox>
        </box>
      ) : null}
      {narrow ? null : <SidePanel registry={registry} history={history} version={version} />}
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}
