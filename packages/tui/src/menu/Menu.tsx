import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { OutLine } from "@pvx/sdk";
import { addModule, resolveModuleRef, removeModule, setEnabled, updateLines, updateModule, type Catalog, type Pending as UpdatePending, type Registry, type Review, type UpdateCheck } from "@pvx/core";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { reloadAndReport } from "../modules/actions.ts";
import { defaultCatalog, useModuleRows, useModulesDeps, useRegistryRev } from "../modules/deps.ts";
import { ReviewScreen } from "../modules/Review.tsx";
import { useRouter, useScreenScope } from "../router.tsx";
import { LogScreen } from "../session/LogScreen.tsx";
import { SessionModals } from "../session/Modals.tsx";
import type { ActHelper, SessionApi } from "../session/store.ts";
import { useTabs } from "../tabs/context.ts";
import { useTheme } from "../theme-context.tsx";
import { AddBox } from "./AddBox.tsx";
import { ItemList, LABEL_W } from "./ItemList.tsx";
import { MenuForm } from "./MenuForm.tsx";
import { Result } from "./Result.tsx";
import { buildCatalog, buildRoot, crumbs, itemsAt, type Item } from "./tree.ts";

/** Where the user is. Lives outside the component: the router unmounts the menu while another screen is on top. */
export interface MenuNav {
  path: string[];
  sel: Record<string, string>;
  /** Showing the Catálogo instead of the installed modules. */
  catalog: boolean;
}
export const createMenuNav = (): MenuNav => ({ path: [], sel: {}, catalog: false });

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const source = (c: Catalog) => `fonte: ${c.source}${c.fetchedAt ? ` · ${hhmm(c.fetchedAt)}` : ""}`;

type View = { kind: "list" } | { kind: "form"; item: Item } | { kind: "result"; id: number } | { kind: "add" };

/** The Módulos tab: the registry as a menu (modules, then command groups, then the form and the result). Arrows and enter; esc goes up; `/` goes to the Comando tab. */
/** Asks whether to install a module that does not fit this system. */
const askIncompatible = (h: ActHelper) => (r: Review) =>
  h.choose("sistema incompatível", [`parece que o ${r.id} não é compatível com este sistema.`, `feito para    ${r.platform.wanted}`, `este sistema  ${r.platform.host}`], ["Entendi, não instalar", "Instalar mesmo assim"]).then((i) => i === 1);

export function Menu({ store, registry, nav, updates = [] }: { store: SessionApi; registry: Registry; nav: MenuNav; updates?: UpdatePending[] }) {
  const router = useRouter();
  const { g } = useTheme();
  const tabs = useTabs();
  const { cols } = useLayout();
  const { pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [path, setPath] = useState(nav.path);
  const [sel, setSel] = useState(nav.sel);
  const [view, setView] = useState<View>({ kind: "list" });
  const [catalog, setCatalog] = useState(nav.catalog);
  const [cat, setCat] = useState<Catalog | null>(null);
  const deps = useModulesDeps();
  const nudge = useNudge();
  nav.path = path;
  nav.sel = sel;
  nav.catalog = catalog;

  const rev = useRegistryRev(registry);
  const { rows } = useModuleRows(registry);
  const root = useMemo(() => buildRoot(registry, rows, updates), [registry, rev, rows, updates]);
  useEffect(() => {
    if (!catalog) return;
    let live = true;
    void defaultCatalog(deps ?? undefined).then((c) => live && setCat(c));
    return () => void (live = false);
  }, [catalog]);
  const ids = new Set(root.map((i) => i.id.slice(2)));
  const listed = cat ? cat.modules.filter((m) => !ids.has(m.id)) : [];
  const items = catalog ? buildCatalog(listed) : itemsAt(root, path);
  const level = catalog ? "catalogo" : path.join("/");
  const cur = items.find((i) => i.id === sel[level]) ?? items[0];
  const atRoot = view.kind === "list" && !path.length;
  // The footer follows the row under the cursor: a module awaiting trust has other keys than a loaded one.
  useScreenScope(!atRoot ? "menu" : catalog ? "catalog" : cur?.module?.state === "aguardando-confianca" ? "modwait" : cur?.module ? "modules" : "menu", atRoot ? 1 : 0);

  const runLine = (line: string, secrets?: Record<string, string>) => {
    void store.run(line, { secrets });
    setView({ kind: "result", id: store.blocks.at(-1)!.id }); // run adds its block synchronously
  };
  /** A host action as a block (same root rule and scrollback as a command), then its output on screen. */
  const act = async (line: string, fn: (h: ActHelper) => Promise<{ exit: number; lines: OutLine[] }>, confirm = false) => {
    const r = await store.act(line, fn, { confirm });
    registry.changed(); // rows, tabs, palette and Início re-read
    return r;
  };
  const review = (id: string, update?: UpdateCheck) =>
    router.push({ id: "review", scope: "review", element: <ReviewScreen id={id} store={store} registry={registry} deps={deps!} update={update} /> });
  const showResult = (id: number) => setView({ kind: "result", id });
  const install = async (e: NonNullable<Item["catalog"]>) => {
    let added: Awaited<ReturnType<typeof addModule>> | undefined;
    const r = await act(`modules add ${e.id}`, async (h) => {
      added = await addModule(e.url, { hostVersion: deps!.load.hostVersion, expectId: e.id, registry, reserved: deps!.reserved, allowFile: deps!.allowFile,
        onIncompatible: askIncompatible(h) });
      const a = added;
      if (!a.ok) return { exit: 1, lines: [{ kind: "error", text: a.error }] };
      if (a.status === "ja-instalado") return { exit: 0, lines: [{ kind: "info", text: `${a.id}: já instalado (${a.state})` }] };
      return { exit: 0, lines: [{ kind: "warning", text: `${a.id} clonado em ${a.sha?.slice(0, 7)}: aguardando confiança, nada foi importado` }] };
    });
    if (added?.ok && added.status === "instalado" && added.state === "aguardando-confianca") review(added.id);
    else showResult(r.id);
  };
  /** Manual add: resolves the ref, clones, opens the same trust review. Returns the inline error, or nothing when the screen moved on. */
  const addRef = async (ref: string): Promise<string | undefined> => {
    let error: string | undefined;
    let added: Awaited<ReturnType<typeof addModule>> | undefined;
    const r = await act(`modules add ${ref}`, async (h) => {
      let url: string;
      try {
        url = await resolveModuleRef(ref);
      } catch (e) {
        return { exit: 1, lines: [{ kind: "error", text: (error = (e as Error).message) }] };
      }
      added = await addModule(url, { hostVersion: deps!.load.hostVersion, registry, reserved: deps!.reserved, allowFile: deps!.allowFile,
        onIncompatible: askIncompatible(h) });
      const a = added;
      if (!a.ok) return { exit: 1, lines: [{ kind: "error", text: (error = a.error) }] };
      if (a.status === "ja-instalado") return { exit: 0, lines: [{ kind: "info", text: `repositório: ${url}` }, { kind: "info", text: `${a.id}: já instalado (${a.state})` }] };
      return { exit: 0, lines: [{ kind: "info", text: `repositório: ${url}` }, { kind: "warning", text: `${a.id} clonado em ${a.sha?.slice(0, 7)}: aguardando confiança, nada foi importado` }] };
    });
    if (error) return error;
    if (added?.ok && added.status === "instalado" && added.state === "aguardando-confianca") setView({ kind: "list" }), review(added.id);
    else showResult(r.id); // no root (fn never ran) or already installed
  };
  const update = async (id: string) => {
    let check: UpdateCheck | undefined;
    const r = await act(`modules update ${id}`, async () => {
      const u = await updateModule(id, { allowFile: deps!.allowFile });
      if (u.ok && u.status === "pendente") check = u.check;
      return { exit: u.ok ? 0 : 1, lines: updateLines(u) };
    });
    if (check) review(id, check);
    else showResult(r.id);
  };
  const toggle = async (m: NonNullable<Item["module"]>) => {
    const on = m.state === "desativado";
    const r = await act(`modules ${on ? "enable" : "disable"} ${m.id}`, async () => {
      const s = setEnabled(m.id, on);
      if (!s.ok) return { exit: 1, lines: [{ kind: "error", text: s.error }] };
      const l = await reloadAndReport(registry, deps!, m.id, "ativado");
      return on ? l : { exit: 0, lines: [{ kind: "success", text: s.text }] };
    });
    showResult(r.id);
  };
  const remove = async (id: string) => {
    const r = await act(`modules remove ${id}`, async () => {
      const x = removeModule(id);
      await reloadAndReport(registry, deps!, id, "removido"); // unregisters: tabs, commands and widgets leave now
      return { exit: x.ok ? 0 : 1, lines: [x.ok ? { kind: "success", text: x.text } : { kind: "error", text: x.error }] };
    }, true);
    showResult(r.id);
  };
  const activate = (item: Item) => {
    if (item.catalog) return deps ? void install(item.catalog) : nudge("somente leitura");
    if (item.module && !item.module.loaded && !item.errorOf) {
      return item.module.state === "aguardando-confianca" && deps ? review(item.id.slice(2)) : nudge("módulo não carregado");
    }
    if (item.page) void store.run(`#${item.page}`); // navigation: pushes the page; esc comes back to this row
    else if (item.children) setPath([...path, item.id]);
    else if (item.errorOf) router.push({ id: "log", element: <LogScreen moduleId={item.errorOf} /> });
    else if (item.args?.length) setView({ kind: "form", item });
    else runLine(item.line!);
  };
  const select = (id: string) => setSel((s) => (s[level] === id ? s : { ...s, [level]: id }));

  useKeys((k) => {
    if (view.kind !== "list" || tabs?.focused === false) return;
    if (k.name === "escape" && path.length) return setPath(path.slice(0, -1)), true;
    if (k.sequence === "/") return tabs?.goto("comando"), true;
    if (path.length) return;
    if (k.sequence === "c") return setCatalog(!catalog), true;
    if (k.sequence === "a" && !k.ctrl) return deps ? setView({ kind: "add" }) : nudge("somente leitura"), true;
    const m = !catalog ? cur?.module : undefined;
    if (!m || !"udxlt".includes(k.sequence) || k.sequence.length !== 1 || k.ctrl) return;
    if (k.sequence === "l") return router.push({ id: "log", element: <LogScreen moduleId={m.id} /> }), true;
    if (!deps) return nudge("somente leitura"), true;
    if (cur!.origin === "official") return nudge("embutido no pvx"), true;
    if (k.sequence === "u") void update(m.id);
    else if (k.sequence === "d") void toggle(m);
    else if (k.sequence === "x") void remove(m.id);
    else if (m.state === "aguardando-confianca") review(m.id);
    else nudge("nada a aprovar");
    return true;
  });

  const back = () => setView({ kind: "list" });
  const helpW = cols - 2 - 4 - LABEL_W - 2;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {view.kind === "form" ? <MenuForm item={view.item} onRun={runLine} onBack={back} /> : null}
      {view.kind === "add" ? <AddBox onSubmit={addRef} onBack={back} /> : null}
      {view.kind === "result" ? <Result store={store} id={view.id} onBack={back} /> : null}
      {view.kind === "list" ? (
        <ItemList items={items} sel={sel[level]} onSel={select} onActivate={activate} onTop={tabs?.focusBar} focused={tabs?.focused ?? true}
          title={catalog ? `${g.query} catálogo${cat ? ` · ${source(cat)}` : ""} · c instalados` : `${g.query} ${["módulos", ...crumbs(root, path)].join(" › ")}${path.length ? "" : " · c catálogo"}`}
          helpW={helpW}
          empty={!catalog ? undefined : !cat ? "carregando catálogo…" : cat.modules.length ? `todos os módulos do catálogo já estão instalados · ${source(cat)}` : `catálogo vazio · ${source(cat)}`} />
      ) : null}
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}
