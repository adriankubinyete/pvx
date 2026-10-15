import { memo, useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Registry } from "@pvx/core";
import { useKeys } from "../keys.tsx";
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
const LIST_W = 44;
const VISIBLE = 14;

interface RowProps { id: string; hit: Hit; selected: boolean; fav: boolean; onHover: (id: string) => void; onPick: (id: string) => void }

/** Memoized: moving the selection repaints two rows, not the list. */
const Row = memo(function Row({ id, hit, selected, fav, onHover, onPick }: RowProps) {
  const { c, g } = useTheme();
  const mark = hit.core ? [g.core, c.info] : hit.page ? [g.page, c.dim] : hit.origin === "official" ? [g.official, c.accent] : hit.origin === "dev" ? [g.dev, c.warn] : [g.thirdParty, c.thirdParty];
  const full = hit.page ? hit.label ?? hit.key : hit.key;
  const max = hit.page && hit.tab ? 26 : 30; // room for the " aba" tag
  const key = full.length > max ? `${full.slice(0, max - 1)}…` : full;
  const [a, b] = hit.range && hit.range[1] <= key.length ? hit.range : [0, 0];
  return (
    <box
      height={1} flexShrink={0} flexDirection="row" paddingX={1}
      backgroundColor={selected ? c.selected : undefined}
      onMouseOver={() => onHover(id)} onMouseDown={() => onPick(id)}
    >
      <text>
        <span fg={mark[1]}>{`${mark[0]} `}</span>
        <span fg={c.text}>{key.slice(0, a)}</span>
        <span fg={c.accent}><b>{key.slice(a, b)}</b></span>
        <span fg={c.text}>{key.slice(b)}</span>
        <span fg={c.dim}>{hit.page && hit.tab ? " aba" : ""}</span>
        <span fg={c.error}>{hit.destructive ? " !" : ""}</span>
        <span fg={c.warn}>{fav ? ` ${g.favorite}` : ""}</span>
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
      section("fav", "favoritos", hits.filter((h) => favs.includes(h.key)));
      section("rec", "recentes", recent.map((k) => hits.find((h) => h.key === k)).filter((h): h is Hit => !!h));
    }
    for (const m of new Set(hits.map((h) => h.moduleId))) section(`m:${m}`, clean(m), hits.filter((h) => h.moduleId === m));
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
    onClose();
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

  useKeys((k) => {
    if (busy) return;
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
  const w = Math.min(cols - 4, 110);
  const body: ReactNode = (
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box width={LIST_W} flexShrink={0} flexDirection="column">
        {lines.length === 0 ? <text fg={c.dim}>{" nada encontrado"}</text> : null}
        {lines.slice(start, start + VISIBLE).map((l) => l.kind === "head"
          ? <text key={l.id} fg={c.dim}>{` ${l.text}`}</text>
          : <Row key={l.id} id={l.id} hit={l.hit} selected={l.id === cur?.id} fav={favs.includes(l.hit.key)} onHover={hover} onPick={pick} />)}
      </box>
      <box flexGrow={1} flexDirection="column" paddingLeft={1}>
        {hit && built ? (
          <>
            {hit.page ? (
              <>
                <text fg={c.text}>{`página ${hit.label}`}</text>
                <text fg={c.dim}>{`módulo ${clean(hit.moduleId)}`}</text>
                <text fg={c.dim}>{hit.tab ? "aba na barra" : "abre com enter"}</text>
              </>
            ) : (
              <>
                <text fg={c.text}>{`${hit.key}${hit.destructive ? " !" : ""}`}</text>
                <text fg={c.dim}>{hit.help}</text>
              </>
            )}
            {hit.page ? null : <Form specs={specs} values={values} focus={focus} cursor={fcur} line={built} last={last} />}
          </>
        ) : null}
      </box>
    </box>
  );
  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={20}>
      <box position="absolute" top={0} left={0} width="100%" height="100%" backgroundColor={c.bg} opacity={0.6} />
      <box
        position="absolute" top={1} left={Math.floor((cols - w) / 2)} width={w} height={Math.min(rows - 2, VISIBLE + 7)}
        flexDirection="column" paddingX={1} backgroundColor={c.panel} {...box(c.accent)}
      >
        <text><span fg={c.accent}>{`${g.query} `}</span><LineText line={{ text: query, cursor: qcur }} focused={focus < 0} width={30} /><span fg={c.dim}>{query ? "" : " @módulo  >comando  #página  !destrutivo"}</span></text>
        {body}
        <text fg={queue.length ? c.accent : c.dim}>{queue.length ? `fila (${queue.length}): ${queue.map((q) => clean(q.display)).join(` ${g.prompt} `)}` : "fila vazia"}</text>
        <text fg={c.warn}>{busy ? "rodando..." : msg}</text>
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
