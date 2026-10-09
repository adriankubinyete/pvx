import { useEffect, useMemo, useReducer, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { currentUser, diary, lastSeen, markSeen, novidades, type DiaryEntry, type Kind } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { useNudge } from "../nudge.tsx";
import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs, type TabId } from "./context.ts";
import { dayRows, detailLines, FILTERS, filterEntries, hhmm, type FilterId } from "./diary.ts";
import type { TabsNav } from "./Tabs.tsx";

/** Diary state that outlives the tab (it unmounts on a switch): filter, cursor, and the last-visit marker of this TUI session. */
export interface DiaryNav {
  filter: FilterId;
  sel?: string;
  /** The marker as it was when the TUI started: Início (the notas widget) and this tab move it on, but "novidades" keeps its count. */
  seenAt?: number;
}
export const createDiaryNav = (): DiaryNav => ({ filter: "tudo", seenAt: lastSeen(currentUser()) });

const LIMIT = 300;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** The Diário tab: every source merged, chips, list by day, detail panel. `n` note, `r` repeat, `p` plan. */
export function DiaryTab({ nav, planTab, addNote }: { nav: TabsNav; /** The tab of the page with role `plan`, when there is one. */ planTab?: TabId; /** Command line of the role `addNote`. */ addNote?: string }) {
  const { c, g, box } = useTheme();
  const { narrow } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const me = useMemo(() => currentUser(), []);
  const d = nav.diary;
  useEffect(() => markSeen(me), [me]);
  const entries = useRef<DiaryEntry[]>([]);
  const load = () => ((entries.current = diary.query({ limit: LIMIT })), bump());
  useMemo(() => (entries.current = diary.query({ limit: LIMIT })), []);
  const now = Date.now();

  const news = useMemo(() => new Set(novidades(entries.current, d.seenAt, me).map((e) => e.id)), [entries.current, d.seenAt, me]);
  const shown = filterEntries(entries.current, d.filter, news);
  const cur = shown.find((e) => e.id === d.sel) ?? shown[0];
  const rows = dayRows(shown, now);
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    if (cur) scroll.current?.scrollChildIntoView(cur.id);
  }, [cur?.id, d.filter]);

  const select = (id: string) => ((d.sel = id), bump());
  const goto = (id: TabId, to: string) => (nav.draft = to, tabs?.goto(id));
  useKeys((k) => {
    if (tabs && !tabs.focused) return;
    if (k.name === "left" || k.name === "right") {
      const f = FILTERS[FILTERS.findIndex((x) => x.id === d.filter) + (k.name === "left" ? -1 : 1)];
      return f ? ((d.filter = f.id), (d.sel = undefined), bump()) : nudge(k.name === "left" ? "primeiro filtro" : "último filtro"), true;
    }
    if (k.name === "up" || k.name === "down") {
      const i = shown.findIndex((e) => e.id === cur?.id);
      if (k.name === "up" && i <= 0) return tabs?.focusBar(), true;
      const to = shown[i + (k.name === "up" ? -1 : 1)];
      return to ? select(to.id) : nudge("fim da lista"), true;
    }
    if (matchKey(k, "u")) return load(), true;
    if (matchKey(k, "n")) return cur ? (addNote ? goto("comando", `${addNote} --ref ${cur.ref} `) : nudge("sem módulo de notas")) : nudge("nada aqui"), true;
    if (matchKey(k, "r")) return cur?.kind === "cmd" ? goto("comando", cur.text) : nudge("só comandos repetem"), true;
    if (matchKey(k, "p")) return cur?.kind !== "conf" ? nudge("só conformidade") : planTab ? tabs?.goto(planTab) : nudge("sem aba Plano"), true;
    if (k.sequence === "/") return tabs?.goto("comando"), true;
  });

  const tone = { dim: c.dim, ok: c.accent, warn: c.warn, error: c.error, info: c.info } as const;
  const kindColor: Record<Kind, string> = { nota: c.info, cmd: c.text, conf: c.warn, login: c.dim, module: c.thirdParty };
  const list = (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} diário`}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
        {!rows.length ? <box paddingX={1} flexShrink={0}><text fg={c.dim}>{entries.current.length ? "nada neste filtro" : "diário vazio"}</text></box> : null}
        {rows.map((r) =>
          r.type === "day" ? (
            <box key={r.id} flexShrink={0} paddingX={1}><text fg={c.dim}><b>{r.label}</b></text></box>
          ) : (
            <box key={r.id} id={r.id} flexShrink={0} paddingX={1} backgroundColor={r.id === cur?.id ? c.selected : undefined} onMouseDown={() => select(r.id)}>
              <text wrapMode="none">
                <span fg={c.dim}>{`${hhmm(r.e.at)} `}</span>
                <span fg={kindColor[r.e.kind]}>{r.e.kind.padEnd(6)}</span>
                <span fg={c.info}>{news.has(r.e.id) ? `${g.active} ` : "  "}</span>
                <span fg={c.dim}>{r.e.user ? `${cut(clean(r.e.user), 10)} ` : ""}</span>
                <span fg={c.text}>{cut(clean(r.e.text), 60)}</span>
                {r.e.kind === "cmd" ? <span fg={r.e.data.exit === 0 ? c.accent : c.error}>{` ${r.e.data.exit === 0 ? g.ok : g.error}`}</span> : null}
              </text>
            </box>
          ),
        )}
      </scrollbox>
    </box>
  );
  const detail = (
    <box flexDirection="column" paddingX={1} overflow="hidden" flexShrink={0} {...(narrow ? { height: 8 } : { width: 40 })} {...box()} title={cur ? `${g.query} ${cur.kind}` : `${g.query} detalhe`}>
      {cur ? detailLines(cur, now).map((l, i) => (
        <text key={i} fg={l.tone ? tone[l.tone] : c.text}>
          {l.label ? <span fg={c.dim}>{`${l.label}  `}</span> : null}
          {clean(l.text)}
        </text>
      )) : <text fg={c.dim}>nada selecionado</text>}
    </box>
  );
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <text wrapMode="none" flexShrink={0} height={1}>
        {FILTERS.flatMap((f) => [
          <span key={f.id} fg={f.id === d.filter ? c.accent : c.dim}>{f.id === d.filter ? <b><u>{f.id}</u></b> : f.id}</span>,
          f.id === "novidades" && news.size ? <span key={`${f.id}#`} fg={c.info}>{` ${g.active}${news.size}`}</span> : null,
          <span key={`${f.id}_`}>{"  "}</span>,
        ])}
      </text>
      <box flexGrow={1} minHeight={0} flexDirection={narrow ? "column" : "row"}>{list}{detail}</box>
    </box>
  );
}
