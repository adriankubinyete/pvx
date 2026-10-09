import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { hostname } from "node:os";
import { primaryIp, readMachine, type SlotHub } from "@pvx/core";
import { hintText, matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { loadFavorites } from "../palette/favorites.ts";
import { clean } from "../palette/search.ts";
import { usePages } from "../sdk-ui/host.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { hhmm } from "./CoreTab.tsx";
import { conformityOf } from "./conformity.ts";
import { activity, fmtUptime, levelOf, meter, parseConformity, relTime, slotItems, syncHost, type Att, type Chip } from "./home.ts";
import type { TabsNav } from "./Tabs.tsx";

const PANELS = ["conformidade", "atividade"] as const;
export type HomePanel = (typeof PANELS)[number];
/** Which panel has the cursor and the selected row of each; lives in `TabsNav` (the tab unmounts on a switch). */
export interface HomeNav {
  panel: HomePanel;
  sel: Record<string, string>;
}
export const createHomeNav = (): HomeNav => ({ panel: "conformidade", sel: {} });

const SIDE_W = 40;
const hms = (t: number) => new Date(t).toTimeString().slice(0, 8);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

interface Row {
  id: string;
  /** Glyph and its color. */
  mark: [string, string];
  text: string;
  /** Right-aligned, dim. */
  note?: string;
  /** What enter puts in the Comando input; no `use` means enter does nothing. */
  use?: string;
}

/** Clips its content (never pushes siblings); `width`/`height` fix it, otherwise it grows. */
function Panel({ title, focused, width, height, children }: { title: string; focused: boolean; width?: number; height?: number; children: React.ReactNode }) {
  const { c, box, g } = useTheme();
  return (
    <box flexDirection="column" paddingX={1} overflow="hidden" minHeight={0} width={width} height={height} flexShrink={width || height ? 0 : 1} flexGrow={width || height ? 0 : 1}
      {...box(focused ? c.accent : undefined)} title={`${g.query} ${title}${focused ? ` ${g.active}` : ""}`}>
      {children}
    </box>
  );
}

function Rows({ rows, sel, focused, w, onPick }: { rows: Row[]; sel?: string; focused: boolean; w: number; onPick: (r: Row) => void }) {
  const { c, g } = useTheme();
  return (
    <scrollbox flexGrow={1} minHeight={0} focused={false}>
      {rows.map((r) => {
        const on = focused && r.id === sel;
        const note = r.note ? ` ${r.note}` : "";
        return (
          <box key={r.id} id={r.id} flexShrink={0} backgroundColor={on ? c.selected : undefined} onMouseDown={() => onPick(r)}>
            <text wrapMode="none">
              <span fg={c.accent}>{on ? `${g.cursor} ` : "  "}</span>
              <span fg={r.mark[1]}>{`${r.mark[0]} `}</span>
              <span fg={c.text}>{cut(r.text, w - 4 - note.length)}</span>
              <span fg={c.dim}>{note}</span>
            </text>
          </box>
        );
      })}
    </scrollbox>
  );
}

/** The Início tab: a dashboard. Machine, conformidade (pending items) and activity; enter on an item puts its command in the Comando input. */
export function HomeTab({ store, nav, profile, slots }: { store: SessionApi; nav: TabsNav; profile?: string | null; slots: SlotHub }) {
  const { c, g } = useTheme();
  const { cols, narrow } = useLayout();
  const tabs = useTabs();
  const focused = tabs?.focused ?? true;
  const { history, blocks } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [m, setM] = useState(readMachine);
  const [readAt, setReadAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  // The only timer: it exists while Início is mounted.
  useEffect(() => {
    const t = setInterval(() => (setM(readMachine()), setReadAt(Date.now()), setNow(Date.now())), 5000);
    return () => clearInterval(t);
  }, []);
  // The slot hub's single scheduler runs while Início is mounted; its changes re-render here.
  const makeLogger = usePages()?.makeLogger;
  useEffect(() => {
    const off = slots.subscribe(bump);
    const stop = slots.start(makeLogger?.("core") ?? { debug() {}, info() {}, warn() {}, error() {} });
    return () => (off(), stop());
  }, [slots]);
  const favorites = useMemo(() => loadFavorites(), []);
  const ip = useMemo(primaryIp, []);

  const color = { ok: c.accent, warn: c.warn, error: c.error };
  const conf = conformityOf(store); // the cache module pages read too
  const snap = useSyncExternalStore(conf.subscribe, conf.getSnapshot);
  const checked = snap.conformidade;
  const done = checked ? parseConformity(checked) : undefined;
  syncHost(slots, done); // the profile's items go through the same slots the modules use
  const mark = (l: Att["level"]): [string, string] => (l === "error" ? [g.error, c.error] : l === "warn" ? [g.warn, c.warn] : [g.ok, c.dim]);
  const attention = slotItems<Att>(slots, "home.attention");
  const brokenRow = (id: string): Row => ({ id: `broken:${id}`, mark: mark("warn"), text: `widget quebrou: ${id}` });
  const chips = slotItems<Chip>(slots, "home.chips");
  const brokenChips = slots.broken("home.chips");
  const rows: Record<HomePanel, Row[]> = {
    conformidade: [
      ...attention.map((a): Row => ({ id: a.title, mark: mark(a.level), text: a.title, use: a.fix })),
      ...slots.broken("home.attention").map(brokenRow),
      ...slotItems<Att>(slots, "home.configured").map((a): Row => ({ id: `ok:${a.title}`, mark: mark("ok"), text: a.title })),
      ...slots.broken("home.configured").map(brokenRow),
    ],
    atividade: activity(history, blocks, favorites).map((a) => ({
      id: a.id,
      mark: a.favorite ? [g.favorite, c.warn] : a.status === "error" ? [g.error, c.error] : a.status === "warn" ? [g.warn, c.warn] : a.status === "ok" ? [g.ok, c.accent] : [" ", c.dim],
      text: clean(a.line),
      note: a.at ? relTime(a.at, now) : undefined,
      use: a.line,
    })),
  };
  const cur = (p: HomePanel) => rows[p].find((r) => r.id === nav.home.sel[p]) ?? rows[p][0];
  const select = (p: HomePanel, id: string) => (nav.home.sel[p] = id, bump());
  const use = (r?: Row) => {
    if (!r?.use) return;
    nav.draft = r.use;
    tabs?.goto("comando");
  };
  const refresh = () => (conf.refresh(), void slots.refresh());

  useKeys((k) => {
    if (!focused) return;
    const p = nav.home.panel;
    if (k.name === "left" || k.name === "right") {
      const next = PANELS[Math.max(0, Math.min(PANELS.length - 1, PANELS.indexOf(p) + (k.name === "left" ? -1 : 1)))]!;
      return nav.home.panel = next, bump(), true;
    }
    if (k.name === "up" || k.name === "down") {
      const i = rows[p].findIndex((r) => r.id === cur(p)?.id);
      if (k.name === "up" && i <= 0) return tabs?.focusBar(), true;
      const to = rows[p][Math.max(0, Math.min(rows[p].length - 1, i + (k.name === "up" ? -1 : 1)))];
      return to && select(p, to.id), true;
    }
    if (matchKey(k, "enter")) return use(cur(p)), true;
    if (matchKey(k, "r")) return refresh(), true;
    if (k.sequence === "/") return tabs?.goto("comando"), true;
  });

  const gauge = (label: string, pct: number, text: string) => {
    const [full, empty] = meter(pct, 10, g);
    return (
      <text wrapMode="none" flexShrink={0}>
        <span fg={c.dim}>{label.padEnd(8)}</span>
        <span fg={color[levelOf(pct)]}>{full}</span>
        <span fg={c.dim}>{empty}</span>
        <span fg={c.text}>{` ${text}`}</span>
      </text>
    );
  };
  const confW = narrow ? cols - 2 : cols - 2 - SIDE_W;

  const total = done?.total ?? 0;
  const pct = total ? (done!.ok / total) * 100 : 0;
  const [cf, ce] = meter(pct, 10, g);
  const worst = attention.some((p) => p.level === "error") ? c.error : c.warn;
  const conformidade = (
    <Panel title="conformidade" focused={focused && nav.home.panel === "conformidade"}>
      <text wrapMode="none" flexShrink={0}>
        {profile ? <span fg={c.accent}>{`perfil ${profile}`}</span> : <span fg={c.dim}>sem perfil</span>}
      </text>
      {snap.running ? <text fg={c.dim} flexShrink={0}>verificando…</text>
        : !done ? <text fg={c.dim} flexShrink={0}>não verificado · r verifica</text>
        : done.message ? <text fg={c.dim} flexShrink={0}>{cut(clean(done.message), confW - 4)}</text>
        : (
          <>
            <text wrapMode="none" flexShrink={0}>
              <span fg={c.text}>{`${slots.read("home.summary")}  `}</span>
              <span fg={attention.length ? worst : c.accent}>{cf}</span>
              <span fg={c.dim}>{ce}</span>
            </text>
            <text fg={c.dim} wrapMode="none" flexShrink={0}>{`verificado às ${hhmm(checked!.at)} · ${hintText("home", "r")}`}</text>
          </>
        )}
      <Rows rows={rows.conformidade} sel={cur("conformidade")?.id} focused={focused && nav.home.panel === "conformidade"} w={confW - 4} onPick={(r) => (select("conformidade", r.id), use(r))} />
    </Panel>
  );
  const maquina = (
    <Panel title="máquina" focused={false} width={narrow ? undefined : SIDE_W} height={narrow ? 8 : undefined}>
      <text wrapMode="none" flexShrink={0}>
        <span fg={c.text}><b>{cut(clean(hostname()), SIDE_W - 4 - (ip ? ip.length + 2 : 0))}</b></span>
        <span fg={c.dim}>{ip ? `  ${ip}` : ""}</span>
      </text>
      {gauge("carga", (m.load / m.cpus) * 100, m.load.toFixed(2))}
      {gauge("ram", m.ramPct, `${Math.round(m.ramPct)}%`)}
      {gauge("disco /", m.diskPct, `${Math.round(m.diskPct)}%`)}
      <text fg={c.dim} wrapMode="none" flexShrink={0}>{`uptime ${fmtUptime(m.uptime)}`}</text>
      <text fg={c.dim} wrapMode="none" flexShrink={0}>{`atualizado ${hms(readAt)}`}</text>
    </Panel>
  );
  const atividade = (
    <Panel title="atividade" focused={focused && nav.home.panel === "atividade"}>
      {rows.atividade.length ? null : <text fg={c.dim} flexShrink={0}>nada executado ainda</text>}
      <Rows rows={rows.atividade} sel={cur("atividade")?.id} focused={focused && nav.home.panel === "atividade"} w={cols - 6} onPick={(r) => (select("atividade", r.id), use(r))} />
    </Panel>
  );

  // Top row: máquina | conformidade; atividade below, full width. Narrow: one column. The areas share the height; each panel clips.
  const chipLine = chips.length || brokenChips.length ? (
    <text wrapMode="none" flexShrink={0} height={1} paddingX={1}>
      {chips.map((ch) => (
        <span key={ch.label}>
          <span fg={color[ch.level]}>{`${ch.level === "ok" ? g.ok : ch.level === "warn" ? g.warn : g.error} ${ch.label}`}</span>
          <span fg={c.dim}>{ch.detail ? ` ${ch.detail}  ` : "  "}</span>
        </span>
      ))}
      {brokenChips.map((id) => <span key={id} fg={c.warn}>{`${g.warn} widget quebrou: ${id}  `}</span>)}
    </text>
  ) : null;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      {chipLine}
      {narrow ? (
        <>{maquina}{conformidade}{atividade}</>
      ) : (
        <>
          <box flexGrow={1} flexBasis={0} minHeight={8} flexDirection="row">{maquina}{conformidade}</box>
          <box flexGrow={1} flexBasis={0} minHeight={6} flexDirection="column">{atividade}</box>
        </>
      )}
    </box>
  );
}
