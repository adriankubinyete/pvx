import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Loading } from "../sdk-ui/flow.tsx";
import type { OutLine } from "@pvx/sdk";
import { addModule, catalogHas, isModuleUrl, resolveModuleRef, removeModule, setEnabled, updateLines, updateModule, type Catalog, type Pending as UpdatePending, type Registry, type Review, type UpdateCheck } from "@pvx/core";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { deliveredTail, reloadAndReport } from "../modules/actions.ts";
import { defaultCatalog, useModuleRows, useModulesDeps, useRegistryRev } from "../modules/deps.ts";
import { ReviewScreen } from "../modules/Review.tsx";
import { useRouter, useScreenScope } from "../router.tsx";
import { LogScreen } from "../session/LogScreen.tsx";
import { SessionModals } from "../session/Modals.tsx";
import type { ActHelper, SessionApi } from "../session/store.ts";
import { useTabs } from "../tabs/context.ts";
import { useTheme } from "../theme-context.tsx";
import { AddBox } from "./AddBox.tsx";
import { ActionMenu } from "./ActionMenu.tsx";
import { CardGrid } from "./CardGrid.tsx";
import { actionCards, cardActions, catalogCards, moduleCards, type ActionId, type Card } from "./cards.ts";
import { ItemList, LABEL_W } from "./ItemList.tsx";
import { MenuForm } from "./MenuForm.tsx";
import { Result } from "./Result.tsx";
import { buildRoot, crumbs, itemsAt, type Item, type Tone } from "./tree.ts";

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

/** Why a direct shortcut does nothing on this card. */
function refusal(card: Card, key: string): string {
  if ("udxr".includes(key) && card.embedded) return "embutido no binário dev";
  if ("udxr".includes(key) && card.official) return "embutido no pvx";
  if (key === "r") return "nada a aprovar";
  if (key === "u" || key === "d") return "aprove o módulo primeiro: r revisa";
  if (key === "t") return "este módulo não tem aba";
  if (key === "w") return "este módulo não tem widgets no Início";
  return "nada a listar";
}

export function Menu({ store, registry, nav, updates = [] }: { store: SessionApi; registry: Registry; nav: MenuNav; updates?: UpdatePending[] }) {
  const router = useRouter();
  const { c, axes, set } = useTheme();
  const tabs = useTabs();
  const { cols } = useLayout();
  const { pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [path, setPath] = useState(nav.path);
  const [sel, setSel] = useState(nav.sel);
  const [view, setView] = useState<View>({ kind: "list" });
  const [catalog, setCatalog] = useState(nav.catalog);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [actions, setActions] = useState<string | null>(null);
  const deps = useModulesDeps();
  const nudge = useNudge();
  nav.path = path;
  nav.sel = sel;
  nav.catalog = catalog;

  const rev = useRegistryRev(registry);
  const { rows, loaded } = useModuleRows(registry);
  const [working, setWorking] = useState<string | undefined>(undefined); // the host action in flight (clone, fetch, reload): never a frozen screen
  const root = useMemo(() => buildRoot(registry, rows, updates), [registry, rev, rows, updates]);
  useEffect(() => {
    if (!catalog && !deps) return; // read-only hosts fetch only when the user opens the catalog
    let live = true;
    void defaultCatalog(deps ?? undefined).then((x) => live && setCat(x), () => {});
    return () => void (live = false);
  }, [catalog, deps]);
  const hiddenTabs = useMemo(() => new Set(axes.hiddenTabs), [axes.hiddenTabs]);
  const hiddenWidgets = useMemo(() => new Set(axes.hiddenWidgets), [axes.hiddenWidgets]);
  const ids = new Set(root.map((i) => i.id.slice(2)));
  const listed = cat ? cat.modules.filter((m) => !ids.has(m.id)) : [];
  const installed = useMemo(() => moduleCards(root, registry, rows, hiddenTabs, hiddenWidgets), [root, registry, rev, rows, hiddenTabs, hiddenWidgets]);
  const cards = catalog ? catalogCards(listed) : [...installed, ...actionCards(cat ? listed.length : undefined)];
  const items = itemsAt(root, path); // the drill-down rows of one module
  const level = catalog ? "catalogo" : path.join("/");
  const curCard = cards.find((x) => x.id === sel[level]) ?? cards[0];
  const atRoot = view.kind === "list" && !path.length;
  useScreenScope(!atRoot ? "menu" : catalog ? "catalog" : "modules", atRoot ? 1 : 0);

  const runLine = (line: string, secrets?: Record<string, string>) => {
    void store.run(line, { secrets });
    setView({ kind: "result", id: store.blocks.at(-1)!.id }); // run adds its block synchronously
  };
  /** A host action as a block (same root rule and scrollback as a command), then its output on screen. */
  const act = async (line: string, fn: (h: ActHelper) => Promise<{ exit: number; lines: OutLine[] }>, confirm = false) => {
    setWorking(line);
    const r = await store.act(line, fn, { confirm }).finally(() => setWorking(undefined));
    registry.changed(); // rows, tabs, palette and Início re-read
    return r;
  };
  /** Back on the installed list with `row` selected. Also writes `nav`: the menu is unmounted while the review is on top. */
  const land = (row?: string) => {
    nav.catalog = false;
    if (row) nav.sel = { ...nav.sel, "": row };
    setCatalog(false);
    setSel(nav.sel);
    setView({ kind: "list" });
  };
  /** Success: the list with the module's row and a notice. Failure: the result screen with the details. */
  const finish = (r: { exit: number; id: number }, id: string, notice: string) => {
    if (r.exit !== 0) return showResult(r.id);
    land(`m:${id}`);
    nudge(notice, "ok");
  };
  const review = (id: string, update?: UpdateCheck) =>
    router.push({ id: "review", scope: "review", element: <ReviewScreen id={id} store={store} registry={registry} deps={deps!} update={update} onDone={(mid) => land(`m:${mid}`)} /> });
  const showResult = (id: number) => setView({ kind: "result", id });
  const install = async (e: NonNullable<Item["catalog"]>) => {
    let added: Awaited<ReturnType<typeof addModule>> | undefined;
    const r = await act(`modules add ${e.id}`, async (h) => {
      added = await addModule(e.url, { hostVersion: deps!.load.hostVersion, expectId: e.id, registry, reserved: deps!.reserved, allowFile: deps!.allowFile,
        catalog: true, onIncompatible: askIncompatible(h) });
      const a = added;
      if (!a.ok) return { exit: 1, lines: [{ kind: "error", text: a.error }] };
      if (a.status === "ja-instalado") return { exit: 0, lines: [{ kind: "info", text: `${a.id}: já instalado (${a.state})` }] };
      return fromCatalog(a.id);
    });
    if (added?.ok && added.status === "instalado") finish(r, e.id, `${e.id} instalado do catálogo (confiança sempre)${deliveredTail(registry, e.id)}`);
    else showResult(r.id);
  };
  /** A catalog module is already approved "always": load it (like after approving) instead of opening the review. */
  const fromCatalog = async (id: string) => {
    const l = await reloadAndReport(registry, deps!, id, "instalado");
    return { exit: l.exit, lines: [{ kind: "info" as const, text: `${id} instalado do catálogo: confiança sempre` }, ...l.lines] };
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
      // A bare id came from the catalog; a URL counts when it equals an entry's. No catalog means a normal review.
      const catalog = !isModuleUrl(ref) && !ref.includes("/") ? true : catalogHas(await defaultCatalog(deps ?? undefined).catch(() => ({ modules: [] })), url);
      added = await addModule(url, { hostVersion: deps!.load.hostVersion, registry, reserved: deps!.reserved, allowFile: deps!.allowFile,
        catalog, onIncompatible: askIncompatible(h) });
      const a = added;
      if (!a.ok) return { exit: 1, lines: [{ kind: "error", text: (error = a.error) }] };
      const repo = { kind: "info" as const, text: `repositório: ${url}` };
      if (a.status === "ja-instalado") return { exit: 0, lines: [repo, { kind: "info", text: `${a.id}: já instalado (${a.state})` }] };
      if (catalog) return fromCatalog(a.id).then((l) => ({ ...l, lines: [repo, ...l.lines] }));
      return { exit: 0, lines: [repo, { kind: "warning", text: `${a.id} clonado em ${a.sha?.slice(0, 7)}: aguardando confiança, nada foi importado` }] };
    });
    if (error) return error;
    if (added?.ok && added.status === "instalado" && added.state === "aguardando-confianca") setView({ kind: "list" }), review(added.id);
    else if (added?.ok && added.status === "instalado") finish(r, added.id, `${added.id} instalado do catálogo (confiança sempre)${deliveredTail(registry, added.id)}`);
    else showResult(r.id); // no root (fn never ran) or already installed
  };
  const update = async (id: string) => {
    let check: UpdateCheck | undefined;
    let res: Awaited<ReturnType<typeof updateModule>> | undefined;
    const r = await act(`modules update ${id}`, async () => {
      const u = (res = await updateModule(id, { allowFile: deps!.allowFile }));
      if (u.ok && u.status === "pendente") check = u.check;
      if (u.ok && u.status === "atualizado") { // an "always" module moved by itself: load what it is now
        const l = await reloadAndReport(registry, deps!, id, "atualizado");
        return { exit: l.exit, lines: [...updateLines(u), ...l.lines] };
      }
      return { exit: u.ok ? 0 : 1, lines: updateLines(u) };
    });
    if (check) review(id, check);
    else if (res?.ok && res.status === "atualizado") finish(r, id, `${id} atualizado para ${res.sha.slice(0, 7)}${res.auto ? " automaticamente" : ""}`);
    else if (res?.ok && res.status === "ja-atualizado") land(`m:${id}`), nudge(`${id} já está atualizado`);
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
    finish(r, m.id, `${m.id} ${on ? "ativado" : "desativado"}`);
  };
  const remove = async (id: string) => {
    const r = await act(`modules remove ${id}`, async () => {
      const x = removeModule(id);
      await reloadAndReport(registry, deps!, id, "removido"); // unregisters: tabs, commands and widgets leave now
      return { exit: x.ok ? 0 : 1, lines: [x.ok ? { kind: "success", text: x.text } : { kind: "error", text: x.error }] };
    }, true);
    if (r.exit !== 0) return showResult(r.id);
    const mods = cards.filter((x) => x.kind === "module");
    const i = mods.findIndex((x) => x.id === `m:${id}`);
    const next = mods[i + 1] ?? mods[i - 1]; // the module card that takes its place
    land(next?.id);
    nudge(`${id} removido`, "ok");
  };
  /** Enter on a row of a module's drill-down. */
  const activate = (item: Item) => {
    if (item.page) void store.run(`#${item.page}`); // navigation: pushes the page; esc comes back to this row
    else if (item.children) setPath([...path, item.id]);
    else if (item.args?.length) setView({ kind: "form", item });
    else runLine(item.line!);
  };
  /** Enter on a card: the action menu; the dashed cards act at once. */
  const activateCard = (card: Card) => {
    if (card.kind === "add") return deps ? setView({ kind: "add" }) : nudge("somente leitura");
    if (card.kind === "open") return setCatalog(true);
    setActions(card.id);
  };
  const toggleTab = (card: Card) => {
    const mid = card.id.slice(2);
    const show = card.tabHidden;
    set({ hiddenTabs: show ? axes.hiddenTabs.filter((x) => x !== mid) : [...axes.hiddenTabs, mid] });
    nudge(`aba ${card.tab!.label} ${show ? "visível" : "oculta"}`, "ok");
  };
  const toggleWidgets = (card: Card) => {
    const mid = card.id.slice(2);
    const show = card.widgetsHidden;
    set({ hiddenWidgets: show ? axes.hiddenWidgets.filter((x) => x !== mid) : [...axes.hiddenWidgets, mid] });
    nudge(`widgets do ${mid} ${show ? "visíveis" : "ocultos"} no Início`, "ok");
  };
  /** Runs one action of a card (from the menu or a direct shortcut). */
  const runAction = (card: Card, id: ActionId) => {
    const m = card.module;
    if (id === "open") return tabs?.goto(card.tab!.id);
    if (id === "children") return setPath([card.id]);
    if (id === "log") return router.push({ id: "log", element: <LogScreen moduleId={m!.id} /> });
    if (id === "tab") return toggleTab(card);
    if (id === "widgets") return toggleWidgets(card);
    if (!deps) return nudge("somente leitura");
    if (id === "install") return void install(card.catalog!);
    if (id === "update") void update(m!.id);
    else if (id === "toggle") void toggle(m!);
    else if (id === "remove") void remove(m!.id);
    else if (id === "review") review(m!.id);
  };
  const select = (id: string) => setSel((s) => (s[level] === id ? s : { ...s, [level]: id }));

  useKeys((k) => {
    if (view.kind !== "list" || tabs?.focused === false) return;
    if (k.name === "escape" && path.length) return setPath(path.slice(0, -1)), true;
    if (k.sequence === "/") return tabs?.goto("comando"), true;
    if (path.length) return;
    if (k.sequence === "c") return setCatalog(!catalog), true;
    if (k.sequence === "a" && !k.ctrl) return deps ? setView({ kind: "add" }) : nudge("somente leitura"), true;
    const card = curCard;
    if (!card || k.ctrl || k.sequence.length !== 1 || !"lutwrdxi".includes(k.sequence)) return;
    const hit = cardActions(card).find((x) => x.key === k.sequence);
    if (hit) return runAction(card, hit.id), true;
    if (card.kind !== "module") return;
    return nudge(refusal(card, k.sequence)), true;
  });

  const back = () => setView({ kind: "list" });
  const helpW = cols - 2 - 4 - LABEL_W - 2;
  const empty = !catalog ? undefined : !cat ? <Loading label="carregando o catálogo…" /> : cat.modules.length ? `todos os módulos do catálogo já estão instalados · ${source(cat)}` : `catálogo vazio · ${source(cat)}`;
  const tone: Record<Tone, string> = { ok: c.ok, warn: c.warn, error: c.error, info: c.info, dim: c.dim };
  const open = actions ? cards.find((x) => x.id === actions) : undefined;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {view.kind === "form" ? <MenuForm item={view.item} onRun={runLine} onBack={back} /> : null}
      {view.kind === "add" ? <AddBox onSubmit={addRef} onBack={back} /> : null}
      {view.kind === "result" ? <Result store={store} id={view.id} onBack={back} /> : null}
      {view.kind === "list" && path.length ? (
        <ItemList items={items} sel={sel[level]} onSel={select} onActivate={activate} onTop={tabs?.focusBar} focused={tabs?.focused ?? true}
          title={`${["módulos", ...crumbs(root, path)].join(" › ")}`} helpW={helpW} />
      ) : null}
      {view.kind === "list" && !path.length ? (
        <box flexGrow={1} minHeight={0} flexDirection="column">
          <box flexShrink={0} height={1} paddingX={1} flexDirection="row" justifyContent="space-between">
            <box flexDirection="row" flexShrink={0}>
              <box flexShrink={0} onMouseDown={() => setCatalog(false)}>
                <text wrapMode="none" fg={catalog ? c.dim : c.accent} bg={catalog ? undefined : c.selected}>{catalog ? ` instalados ${installed.length} ` : <b>{` instalados ${installed.length} `}</b>}</text>
              </box>
              <text wrapMode="none">{"  "}</text>
              <box flexShrink={0} onMouseDown={() => setCatalog(true)}>
                <text wrapMode="none" fg={catalog ? c.accent : c.dim} bg={catalog ? c.selected : undefined}>{catalog ? <b>{` catálogo${cat ? ` ${listed.length}` : ""} `}</b> : " catálogo "}</text>
              </box>
              <text wrapMode="none"><span>{"   "}</span><span fg={c.accent}><b>c</b></span><span fg={c.dim}>{" alterna"}</span></text>
            </box>
            {working ? <Loading label={`${working}…`} /> : !catalog && !loaded ? <Loading label="lendo os módulos…" /> : catalog && cat ? <text fg={c.dim} wrapMode="none">{source(cat)}</text> : null}
          </box>
          <CardGrid cards={cards} sel={sel[level]} onSel={select} onActivate={activateCard} onTop={tabs?.focusBar} focused={(tabs?.focused ?? true) && !open} empty={empty} />
          <Detail card={curCard} tone={tone} />
        </box>
      ) : null}
      {open ? <ActionMenu title={open.name} actions={cardActions(open)} onPick={(id) => (setActions(null), runAction(open, id))} onClose={() => setActions(null)} /> : null}
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}

/** The strip under the grid: where the selected card comes from, and its warning. */
function Detail({ card, tone }: { card?: Card; tone: Record<Tone, string> }) {
  const { c, box } = useTheme();
  const b = box();
  return (
    <box flexShrink={0} height={b.border ? 3 : 2} flexDirection="column" paddingX={1} border={b.border ? ["top"] : false} borderStyle={b.borderStyle} borderColor={b.borderColor}>
      <text wrapMode="none">
        {card?.detail.parts.map((p, i) => <span key={i} fg={p.tone === "name" ? c.text : p.tone ? tone[p.tone] : c.dim}>{p.tone === "name" ? <b>{p.text}</b> : p.text}</span>)}
      </text>
      <text wrapMode="none" fg={card?.detail.warn ? tone[card.detail.warn.tone] : c.dim}>{card?.detail.warn?.text ?? ""}</text>
    </box>
  );
}
