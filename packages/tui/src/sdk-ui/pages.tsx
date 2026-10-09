import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { RegisteredPage } from "@pvx/core";
import type { Component, SdkUi } from "@pvx/sdk";
import { matchKey, setPageRows, type Scope } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { MenuForm } from "../menu/MenuForm.tsx";
import { clean } from "../palette/search.ts";
import { Boundary, useRouter, type Screen } from "../router.tsx";
import { SessionModals } from "../session/Modals.tsx";
import { useTabs } from "../tabs/context.ts";
import { useTheme } from "../theme-context.tsx";
import { HostCtx, runOwn, useHost, usePages, type HostPage } from "./host.tsx";

/** Keys the host owns: a page cannot take them over. */
const RESERVED = ["esc", "?", "ctrl+c", "ctrl+k"];
const keysOf = (page: RegisteredPage) => (page.keys ?? []).filter((k) => !RESERVED.includes(k.keys));

/** The footer scope of a page. Registers the page's own keys in the shortcut table (footer and `?` read them from there). */
export function pageScope(page: RegisteredPage): Scope {
  const scope: Scope = `page:${page.key}`;
  setPageRows(scope, keysOf(page).map((k) => ({ keys: clean(k.keys), label: clean(k.label), scope, footer: true })));
  return scope;
}

/** A page as a router screen. A throw while rendering is the router boundary's: log, back to the previous screen, notice. */
export const pageScreen = (page: RegisteredPage): Screen => ({ id: `#${page.key}`, scope: pageScope(page), element: <PageContent page={page} /> });

/** Frame, keys and host context of one page. `enabled` false: a page kept mounted behind another tab ignores keys. */
export function PageContent({ page, enabled = true }: { page: RegisteredPage; enabled?: boolean }) {
  const deps = usePages();
  if (!deps) throw new Error("páginas indisponíveis: o App não recebeu `pages`");
  const router = useRouter();
  const { box, g } = useTheme();
  const { pending } = useSyncExternalStore(deps.session.subscribe, deps.session.getSnapshot);
  const host = useMemo<HostPage>(() => ({
    moduleId: page.moduleId,
    deps,
    push(name) {
      const next = deps.registry.pages.get(`${page.moduleId}.${name}`);
      if (!next) throw new Error(`página desconhecida neste módulo: "${name}"`);
      router.push(pageScreen(next));
    },
    pop: router.pop,
  }), [page.moduleId, deps, router.push, router.pop]);
  useKeys((k) => {
    if (!enabled) return;
    const spec = keysOf(page).find((s) => matchKey(k, s.keys));
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
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingX={1} {...box()} title={`${g.query} ${clean(page.title)}`}>
        <Render page={page} />
      </box>
      {enabled && router.scope !== "palette" ? <SessionModals store={deps.session} pending={pending} /> : null}
    </HostCtx.Provider>
  );
}

/** `render()` runs as part of this component, so a page may call hooks in it. */
function Render({ page }: { page: RegisteredPage }) {
  return <>{page.render() as ReactNode}</>;
}

/** A page-tab pane. A throw shows inline (the tab bar is the root: there is no screen to go back to) and goes to the module log. */
export function PagePane({ page, active }: { page: RegisteredPage; active: boolean }) {
  const deps = usePages()!;
  const tabs = useTabs();
  useKeys((k) => {
    if (active && tabs?.focused !== false && k.name === "escape") return tabs?.focusBar(), true; // like the other tabs: back to the bar
  });
  return (
    <Boundary
      onCatch={(err) => deps.makeLogger(page.moduleId).error(`página "${page.key}" falhou: ${err.stack ?? err.message}`)}
      fallback={(err) => <PageError title={page.title} err={err} />}
    >
      <PageContent page={page} enabled={active && tabs?.focused !== false} />
    </Boundary>
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

/** `sdk.ui.Form`: the form of one of the module's commands (the Módulos menu's). */
export const Form: Component<Parameters<SdkUi["Form"]>[0]> = ({ command, onRun, onCancel }) => {
  const host = useHost();
  const cmd = host.deps.registry.commands.get(command);
  if (!cmd || cmd.moduleId !== host.moduleId) throw new Error(`Form: "${command}" não é um comando deste módulo`);
  if (!cmd.args?.length) return <text>{`${clean(command)}: sem argumentos`}</text>;
  const item = { id: command, label: command, help: clean(cmd.help), line: command, args: cmd.args };
  return <MenuForm item={item} onRun={(line, secrets) => void runOwn(host, line, secrets).then((r) => onRun?.(r))} onBack={() => onCancel?.()} />;
};
