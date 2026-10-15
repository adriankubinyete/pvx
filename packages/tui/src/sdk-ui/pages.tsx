import { useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { RegisteredPage } from "@pvx/core";
import type { Component, KeySpec, SdkUi } from "@pvx/sdk";
import { addPageRow, matchKey, setPageRows, type Scope } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { clean } from "../palette/search.ts";
import { Boundary, useRouter, type Screen } from "../router.tsx";
import { SessionModals } from "../session/Modals.tsx";
import { useTabs } from "../tabs/context.ts";
import { tabOf } from "../tabs/pageTabs.ts";
import { useTheme } from "../theme-context.tsx";
import { CommandForm } from "./command-form.tsx";
import { helpOf } from "./labels.ts";
import { activeBack, BackCtx, FocusCtx, HostCtx, runOwn, useHost, usePages, type BackEntry, type HostPage } from "./host.tsx";

/** Keys the host owns: a page cannot take them over. */
const RESERVED = ["esc", "?", "ctrl+c", "ctrl+k"];
const keysOf = (page: RegisteredPage) => (page.keys ?? []).filter((k) => !RESERVED.includes(k.keys));
const rowOf = (scope: Scope, k: KeySpec) => ({ keys: clean(k.keys), label: clean(k.label), scope, footer: !k.help });

/** The footer scope of a page. Registers the page's own keys in the shortcut table (footer and `?` read them from there). */
export function pageScope(page: RegisteredPage): Scope {
  const scope: Scope = `page:${page.key}`;
  setPageRows(scope, keysOf(page).map((k) => rowOf(scope, k)));
  return scope;
}

/** A page as a router screen. A throw while rendering is the router boundary's: log, back to the previous screen, notice. */
export const pageScreen = (page: RegisteredPage): Screen => ({ id: `#${page.key}`, scope: pageScope(page), element: <PageContent page={page} /> });

/** Frame, keys and host context of one page. `enabled` false: a page kept mounted behind another tab ignores keys. */
export function PageContent({ page, enabled = true }: { page: RegisteredPage; enabled?: boolean }) {
  const deps = usePages();
  if (!deps) throw new Error("páginas indisponíveis: o App não recebeu `pages`");
  const router = useRouter();
  const { pending } = useSyncExternalStore(deps.session.subscribe, deps.session.getSnapshot);
  const dynKeys = useRef(new Set<KeySpec>()).current; // `useKey`: the keys of the components mounted in this page
  const outerBacks = useContext(BackCtx); // set by PagePane, which owns esc in a tab
  const ownBacks = useRef<BackEntry[]>([]).current;
  const backs = outerBacks ?? ownBacks;
  const scope: Scope = `page:${page.key}`;
  const host = useMemo<HostPage>(() => ({
    moduleId: page.moduleId,
    deps,
    push(name) {
      const next = deps.registry.pages.get(`${page.moduleId}.${name}`);
      if (!next) throw new Error(`página desconhecida neste módulo: "${name}"`);
      router.push(pageScreen(next));
    },
    pop: router.pop,
    addKey(spec) {
      if (RESERVED.includes(spec.keys)) return () => {};
      dynKeys.add(spec);
      const off = addPageRow(scope, rowOf(scope, spec));
      return () => (dynKeys.delete(spec), off());
    },
    addBack(entry) {
      backs.push(entry);
      return () => void backs.splice(backs.indexOf(entry), 1);
    },
  }), [page.moduleId, page.key, deps, router.push, router.pop, backs]);
  // In a tab `enabled` already says it (active, bar not focused); a pushed page must also be the top screen.
  const focused = enabled && (!!outerBacks || router.top.id === `#${page.key}`);
  useKeys((k) => {
    if (!enabled) return;
    if (k.name === "escape" && !outerBacks) { // pushed page: a useBack takes esc, else the router pops
      const back = activeBack(backs);
      return back ? (back(), true) : undefined;
    }
    const spec = [...dynKeys, ...keysOf(page)].find((s) => matchKey(k, s.keys));
    if (!spec) return;
    try {
      spec.run();
    } catch (e) {
      deps.makeLogger(page.moduleId).error(`tecla "${spec.keys}" da página "${page.key}" falhou: ${(e as Error).stack ?? e}`);
    }
    return true;
  });
  return (
    <HostCtx.Provider value={host}>
      <FocusCtx.Provider value={focused}>
        <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1} overflow="hidden">
          {outerBacks ? null : <Breadcrumb page={page} />}
          <Render page={page} />
        </box>
        {enabled && router.scope !== "palette" ? <SessionModals store={deps.session} pending={pending} /> : null}
      </FocusCtx.Provider>
    </HostCtx.Provider>
  );
}

/** The labels above a pushed page, root first: the module's tab (or its id) and the page title, without a repeat. */
export function crumbOf(rootLabel: string, pageTitle: string): string[] {
  return rootLabel.toLowerCase() === pageTitle.toLowerCase() ? [pageTitle] : [rootLabel, pageTitle];
}

/** A pushed page has no tab bar entry of its own: one dim line says where it is. A page shown as a tab needs none, the tab names it. */
function Breadcrumb({ page }: { page: RegisteredPage }) {
  const { c, g } = useTheme();
  const deps = usePages()!;
  const root = tabOf(deps.registry, page.moduleId)?.label ?? page.moduleId;
  return <text fg={c.dim} wrapMode="none" flexShrink={0}>{crumbOf(root, clean(page.title)).join(` ${g.query} `)}</text>;
}

/** `render()` runs as part of this component, so a page may call hooks in it. */
function Render({ page }: { page: RegisteredPage }) {
  return <>{page.render() as ReactNode}</>;
}

/** A page-tab pane. A throw shows inline (the tab bar is the root: there is no screen to go back to) and goes to the module log. */
export function PagePane({ page, active }: { page: RegisteredPage; active: boolean }) {
  const deps = usePages()!;
  const tabs = useTabs();
  const backs = useRef<BackEntry[]>([]).current;
  useKeys((k) => {
    if (!active || tabs?.focused === false || k.name !== "escape") return;
    const back = activeBack(backs);
    return back ? back() : tabs?.focusBar(), true; // a useBack takes esc; else back to the bar like the other tabs
  });
  return (
    <BackCtx.Provider value={backs}>
      <Boundary
        onCatch={(err) => deps.makeLogger(page.moduleId).error(`página "${page.key}" falhou: ${err.stack ?? err.message}`)}
        fallback={(err) => <PageError title={page.title} err={err} />}
      >
        <PageContent page={page} enabled={active && tabs?.focused !== false} />
      </Boundary>
    </BackCtx.Provider>
  );
}

function PageError({ title, err }: { title: string; err: Error }) {
  const { result } = useTheme();
  const r = result("error");
  return <text fg={r.color} flexShrink={0}>{`${r.marker} página "${clean(title)}" falhou: ${clean(err.message)}`}</text>;
}

/** Mounted once by `App`: `#page` and a command's `page` push the screen from anywhere. Renders nothing. */
export function PageHost() {
  const deps = usePages();
  const { push } = useRouter();
  useEffect(() => deps?.session.onPage((key) => {
    const page = deps.registry.pages.get(key);
    if (page) push(pageScreen(page));
  }), [deps, push]);
  return null;
}

/** `sdk.ui.Form`: the form of one of the module's commands, drawn by `Fields` (no box, no command line). */
export const Form: Component<Parameters<SdkUi["Form"]>[0]> = ({ command, title, description, submitLabel, busyLabel, derive, onRun, onCancel }) => {
  const host = useHost();
  const cmd = host.deps.registry.commands.get(command);
  if (!cmd || cmd.moduleId !== host.moduleId) throw new Error(`Form: "${command}" não é um comando deste módulo`);
  if (!cmd.args?.length) return <text>{`${clean(command)}: sem argumentos`}</text>;
  const run = (line: string, secrets: Record<string, string>) => runOwn(host, line, secrets).then((result) => onRun?.(result));
  return <CommandForm line={command} args={cmd.args} title={title ?? clean(cmd.title ?? cmd.help)} description={description ?? (cmd.title ? helpOf(cmd.help) : undefined)} submitLabel={submitLabel} busyLabel={busyLabel} derive={derive} onRun={run} onCancel={() => onCancel?.()} />;
};
