import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Registry } from "@pvx/core";
import { useKeys } from "../keys.tsx";
import { BACKGROUND_NUDGE } from "../sdk-ui/busy.ts";
import { Loading } from "../sdk-ui/flow.tsx";
import { useNudge } from "../nudge.tsx";
import { matchKey } from "../keymap.ts";
import { editLine } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useLayout } from "../layout.ts";
import { useFooterScope } from "../router.tsx";
import { SessionModals } from "../session/Modals.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { favoritesPath, loadFavorites, saveFavorites } from "./favorites.ts";
import { Form } from "./Form.tsx";
import { buildLine, type FormValues } from "./form.ts";
import { useRegistryRev } from "../modules/deps.ts";
import { requestTab } from "../tabs/context.ts";
import { clean, search, type Hit } from "./search.ts";

/** What the palette needs from the session. `secrets` go to `execute` as env/promptSecret, never argv. */
export type SessionLike = Pick<SessionApi, "run" | "history" | "answer" | "subscribe" | "getSnapshot"> & Partial<Pick<SessionApi, "cancel">>;

export interface PaletteProps {
  session: SessionLike;
  registry: Registry;
  onClose: () => void;
  /** Override of `$PVX_HOME/palette-favorites.json` (tests). */
  favoritesFile?: string;
}

type Line = { kind: "head"; id: string; text: string } | { kind: "item"; id: string; hit: Hit };
/** Rows of the list the dialog shows at once. */
const VISIBLE = 10;
/** Rows of the dialog besides the list and the form: the border (2), the query, a rule, a rule and the footer. */
const DIALOG_CHROME_ROWS = 6;
const DIALOG_MAX_W = 90;
/** Cells of the dialog taken by its border and padding. */
const DIALOG_CHROME_W = 4;
const KEY_COLUMN_MAX_W = 34;
const KEY_COLUMN_SHARE = 0.42;
/** Cells of the right edge of a row: marks and the key that runs it. */
const HINT_W = 8;
/** Section headings of the list. */
const HEADINGS = { fav: "favoritos", rec: "recentes", commands: "comandos", pages: "páginas" } as const;
const FOOTER_HINT = "enter roda · tab completa · ctrl+f favorito · esc fecha";
const SELECTED_HINT = "enter";
/** What the empty field offers: the prefixes that narrow the search. */
const QUERY_SCOPES = " @módulo  >comando  #página  !destrutivo";

interface RowProps { id: string; hit: Hit; selected: boolean; fav: boolean; width: number; onHover: (id: string) => void; onPick: (id: string) => void }

/** The text a row shows first: a command's key, a page's title. */
const nameOf = (hit: Hit): string => (hit.page ? hit.label ?? hit.key : hit.key);
/** The dim text after the name: what the command does, or where the page is. */
const noteOf = (hit: Hit): string => (hit.page ? `${clean(hit.moduleId)}${hit.tab ? " · aba" : ""}` : hit.help);

/** The text split in runs: `matched` for the parts the query marks (the letters of each word), plain for the rest. */
function runsOf(text: string, ranges: [number, number][]): { text: string; matched: boolean }[] {
  const runs: { text: string; matched: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start >= text.length) break;
    if (start > at) runs.push({ text: text.slice(at, start), matched: false });
    runs.push({ text: text.slice(start, Math.min(end, text.length)), matched: true });
    at = Math.min(end, text.length);
  }
  if (at < text.length) runs.push({ text: text.slice(at), matched: false });
  return runs;
}

/** Memoized: moving the selection repaints two rows, not the list. */
const Row = memo(function Row({ id, hit, selected, fav, width, onHover, onPick }: RowProps) {
  const { c, g } = useTheme();
  const nameW = Math.min(KEY_COLUMN_MAX_W, Math.floor(width * KEY_COLUMN_SHARE));
  const full = nameOf(hit);
  const name = full.length > nameW ? `${full.slice(0, nameW - 1)}…` : full;
  const ranges = hit.ranges.filter(([start]) => start < name.length);
  const noteW = Math.max(0, width - 2 - nameW - 2 - HINT_W);
  const note = noteOf(hit);
  const shownNote = note.length > noteW ? `${note.slice(0, Math.max(0, noteW - 1))}…` : note;
  const marks = `${fav ? g.favorite : ""}${hit.destructive ? "!" : ""}`;
  const hint = [marks, selected ? SELECTED_HINT : ""].filter(Boolean).join(" ");
  return (
    <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" backgroundColor={selected ? c.selected : undefined} onMouseOver={() => onHover(id)} onMouseDown={() => onPick(id)}>
      <text wrapMode="none">
        {selected ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span>{"  "}</span>}
        {runsOf(name, ranges).map((run, i) => (run.matched ? <span key={i} fg={c.accent}><b>{run.text}</b></span> : <span key={i} fg={c.text}>{run.text}</span>))}
        <span>{" ".repeat(Math.max(0, nameW - name.length) + 2)}</span>
        <span fg={c.dim}>{shownNote}</span>
      </text>
      <text wrapMode="none" flexShrink={0}>
        <span fg={hit.destructive ? c.error : fav ? c.warn : c.dim}>{hint}</span>
      </text>
    </box>
  );
});

/** Overlay opened by ctrl+k. Modal: owns the keyboard. Backdrop and dialog are siblings (opacity pitfall). */
export function Palette({ session, registry, onClose, favoritesFile }: PaletteProps) {
  const { c, g, box } = useTheme();
  const { cols, rows } = useLayout();
  useFooterScope("palette");
  const nudge = useNudge();
  // A queued command may ask (confirm, secret) while only this overlay is on screen, so it renders the modals itself.
  const { pending } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [query, setQuery] = useState("");
  // Cursors count code points; `Infinity` means "at the end" and is clamped where it is used (focus changes land there).
  const [qcur, setQcur] = useState(0);
  const [fcur, setFcur] = useState(Infinity);
  const [selId, setSelId] = useState("");
  const [focus, setFocus] = useState(-1); // form field index, -1 = list
  const [forms, setForms] = useState<Record<string, FormValues>>({});
  const [favs, setFavs] = useState(() => loadFavorites(favoritesFile ?? favoritesPath()));
  const [queue, setQueue] = useState<{ display: string; secrets: Record<string, string> }[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const left = useRef(false); // esc closed the palette while the queue was still running

  const rev = useRegistryRev(registry); // a module added or removed while the palette is open
  const hits = useMemo(() => search(registry, query), [registry, rev, query]);
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    const section = (id: string, text: string, list: Hit[]) => {
      if (!list.length) return;
      out.push({ kind: "head", id: `h:${id}`, text });
      for (const hit of list) out.push({ kind: "item", id: `${id}:${hit.key}`, hit });
    };
    if (!query.trim()) {
      // Longest command key that prefixes the line (core or module).
      const keyOf = (l: string) => hits.filter((h) => !h.page && (l === h.key || l.startsWith(`${h.key} `))).sort((a, b) => b.key.length - a.key.length)[0]?.key;
      const recent = [...new Set([...session.history].reverse().map(keyOf).filter((k): k is string => !!k))].slice(0, 3);
      section("fav", HEADINGS.fav, hits.filter((h) => favs.includes(h.key)));
      section("rec", HEADINGS.rec, recent.map((k) => hits.find((h) => h.key === k)).filter((h): h is Hit => !!h));
    }
    section("commands", HEADINGS.commands, hits.filter((h) => !h.page));
    section("pages", HEADINGS.pages, hits.filter((h) => h.page));
    return out;
  }, [hits, query, favs, registry, rev, session.history]);

  const items = lines.filter((l) => l.kind === "item");
  const cur = items.find((l) => l.id === selId) ?? items[0];
  const hit = cur?.kind === "item" ? cur.hit : undefined;
  const cmd = hit && !hit.page ? registry.commands.get(hit.key) : undefined;
  const specs = hit?.args ?? cmd?.args ?? [];
  const values = (hit && forms[hit.key]) || {};
  const built = hit ? (hit.page ? { argv: [], display: `#${hit.key}`, secrets: {}, missing: [] } : buildLine(hit.key, specs, values)) : undefined;
  const last = hit ? [...session.history].reverse().find((l) => l === hit.key || l.startsWith(`${hit.key} `)) : undefined;

  const hover = useCallback((id: string) => setSelId(id), []);
  const pick = useCallback((id: string) => (setSelId(id), setFocus(-1)), []);
  const focusField = (i: number) => (setFocus(i), setFcur(Infinity));
  const move = (d: number) => {
    const i = items.findIndex((l) => l.id === cur?.id);
    const to = items[i + d];
    if (to) setSelId(to.id);
    else nudge(!items.length ? "nada aqui" : d < 0 ? "início da lista" : "fim da lista");
  };
  const edit = (name: string, v: string | boolean) => hit && setForms((f) => ({ ...f, [hit.key]: { ...f[hit.key], [name]: v } }));

  async function runAll(list: { display: string; secrets: Record<string, string> }[]) {
    setBusy(true);
    for (const it of list) if ((await session.run(it.display, { secrets: it.secrets })).exit !== 0) break; // stops at the first failure
    if (!left.current) onClose();
  }
  const ready = () => {
    if (!built) return null;
    if (built.missing.length) return setMsg(`falta: ${built.missing.join(", ")} (tab)`), null;
    return { display: built.display, secrets: built.secrets };
  };

  const enqueue = () => {
    const it = ready();
    if (it) setQueue([...queue, it]);
  };

  /** While the queue runs only `esc` works: it closes the palette and the commands go on. */
  const leaveBusy = () => {
    left.current = true;
    nudge(BACKGROUND_NUDGE);
    onClose();
  };

  useKeys((k) => {
    if (busy) {
      if (matchKey(k, "esc")) leaveBusy();
      return;
    }
    setMsg("");
    if (matchKey(k, "esc")) return focus >= 0 ? setFocus(-1) : onClose();
    if (matchKey(k, "ctrl+enter") || matchKey(k, "ctrl+j")) return queue.length ? void runAll(queue) : setMsg("fila vazia");
    if (matchKey(k, "ctrl+f")) {
      if (!hit) return;
      const next = favs.includes(hit.key) ? favs.filter((f) => f !== hit.key) : [...favs, hit.key];
      return setFavs(next), saveFavorites(next, favoritesFile ?? favoritesPath());
    }
    if (matchKey(k, "ctrl+n")) return enqueue();
    if (matchKey(k, "enter")) {
      // A page that is also a tab switches to it; otherwise `#page` goes through the session (pushes the screen).
      if (hit?.page && registry.pages.get(hit.key)?.tab && requestTab(`page:${hit.key}`)) return onClose();
      const it = ready();
      return it ? void runAll([it]) : undefined;
    }
    const f = focus >= 0 ? specs[focus] : undefined;
    const text = f ? String(values[f.name] ?? "") : query;
    const cursor = Math.min(f ? fcur : qcur, [...text].length);
    if (f?.kind === "flag") {
      if (k.name === "left") return setFocus(-1), true;
      if (k.sequence === " ") return edit(f.name, values[f.name] !== true), true;
    } else if (!(k.sequence === " " && !f && !query)) { // empty query: space enqueues (below)
      const r = editLine({ text, cursor }, k);
      if (r?.exit === "left" && f) return setFocus(-1), true; // the cursor tried to cross the start: back to the list, same command
      if (r?.exit === "left" && !f) return nudge(), true;
      if (r?.exit === "right" && !f) return specs.length ? focusField(0) : nudge("sem argumentos"), true;
      if (r) {
        if (f) edit(f.name, r.text), setFcur(r.cursor);
        else r.text !== query && setSelId(""), setQuery(r.text), setQcur(r.cursor);
        return true;
      }
    }
    if (k.name === "right" && focus < 0) return specs.length ? focusField(0) : nudge("sem argumentos"), true;
    if (matchKey(k, "tab")) return specs.length ? focusField((focus + 1) % specs.length) : setFocus(-1);
    if (k.name === "up" || k.name === "down") {
      const d = k.name === "up" ? -1 : 1;
      if (focus < 0) return move(d);
      const to = focus + d;
      return to >= 0 && to < specs.length ? focusField(to) : nudge(d < 0 ? "início da lista" : "fim da lista"), true;
    }
    if (k.sequence === " " && !f && !query) return enqueue(); // once there is a query, space is part of it (ctrl+n enqueues)
  }, { modal: true, paste: true });

  const at = Math.max(0, lines.findIndex((l) => l.id === cur?.id));
  const start = Math.max(0, Math.min(at - Math.floor(VISIBLE / 2), lines.length - VISIBLE));
  const w = Math.min(cols - 4, DIALOG_MAX_W);
  const innerW = w - DIALOG_CHROME_W;
  const shown = lines.slice(start, start + VISIBLE);
  const hasForm = Boolean(hit && !hit.page && built);
  const formRows = hasForm ? specs.length + 1 + (Object.keys(built!.secrets).length ? 1 : 0) + (last ? 1 : 0) : 0;
  const listRows = Math.max(1, shown.length);
  const height = Math.min(rows - 2, DIALOG_CHROME_ROWS + listRows + formRows + (queue.length ? 1 : 0));
  const rule = <text wrapMode="none" flexShrink={0} fg={c.border}>{g.hline.repeat(innerW)}</text>;
  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={20}>
      <box position="absolute" top={0} left={0} width="100%" height="100%" backgroundColor={c.bg} opacity={0.6} />
      <box
        position="absolute" top={1} left={Math.floor((cols - w) / 2)} width={w} height={height}
        flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.border)}
      >
        <text wrapMode="none" flexShrink={0}>
          <span fg={c.accent}>{`${g.query} `}</span>
          <LineText line={{ text: query, cursor: qcur }} focused={focus < 0} width={query ? innerW - 2 : 1} pad={Boolean(query)} />
          {query ? null : <span fg={c.dim}>{QUERY_SCOPES}</span>}
        </text>
        {rule}
        <box flexDirection="column" flexShrink={0}>
          {lines.length === 0 ? <text fg={c.dim}>{"  nada encontrado"}</text> : null}
          {shown.map((l) => l.kind === "head"
            ? <text key={l.id} fg={c.dim} wrapMode="none">{l.text}</text>
            : <Row key={l.id} id={l.id} hit={l.hit} selected={l.id === cur?.id} fav={favs.includes(l.hit.key)} width={innerW} onHover={hover} onPick={pick} />)}
        </box>
        {hasForm ? <Form specs={specs} values={values} focus={focus} cursor={fcur} line={built!} last={last} /> : null}
        {queue.length ? <text wrapMode="none" fg={c.accent}>{`fila (${queue.length}): ${queue.map((q) => clean(q.display)).join(` ${g.prompt} `)}`}</text> : null}
        {rule}
        {busy ? <Loading label="rodando…" /> : <text wrapMode="none" flexShrink={0} fg={msg ? c.warn : c.dim}>{msg || FOOTER_HINT}</text>}
      </box>
      <SessionModals store={session} pending={pending} />
    </box>
  );
}

/** Binds ctrl+k and renders the overlay. Mounted once by `App`, so it opens from every screen. */
export function PaletteHost(props: Omit<PaletteProps, "onClose">) {
  const [shown, setShown] = useState(false);
  useKeys((k) => (matchKey(k, "ctrl+k") ? (setShown(true), true) : undefined), { base: true });
  return shown ? <Palette {...props} onClose={() => setShown(false)} /> : null;
}
