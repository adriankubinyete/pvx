import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { createMachineSampler, pageWithRole, type MachineSampler, type Registry } from "@pvx/core";
import { hintText, matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useNudge } from "../nudge.tsx";
import { panelStep, usePanelNav } from "../panelnav.ts";
import { useLayout } from "../layout.ts";
import { useScreenScope } from "../router.tsx";
import { loadFavorites } from "../palette/favorites.ts";
import { clean } from "../palette/search.ts";
import { usePages } from "../sdk-ui/host.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { hhmm } from "./CoreTab.tsx";
import { conformityOf } from "./conformity.ts";
import { machineCard, planCard, type Tone } from "./machine-card.ts";
import { activity, meter, parseConformity, relTime, slotItems, syncHost, type Att, type Chip } from "./home.ts";
import type { TabsNav } from "./Tabs.tsx";

const BASE_PANELS = ["conformidade", "atividade"] as const;
/** `maquina` takes the cursor as a whole but has no items and no number. */
export type HomePanel = (typeof BASE_PANELS)[number] | "notas" | "maquina";
/** Which panel has the cursor and the selected row of each; lives in `TabsNav` (the tab unmounts on a switch). */
export interface HomeNav {
  panel: HomePanel;
  /** On the items of the panel (the selection shows) instead of on the panel as a whole. */
  inside: boolean;
  sel: Record<string, string>;
}
export const createHomeNav = (): HomeNav => ({ panel: "conformidade", inside: false, sel: {} });

/** Outer width of the máquina panel beside conformidade; its inner width is 4 less (border and padding). */
const machWidth = (cols: number) => (cols >= 200 ? 100 : 58);
const SAMPLE_MS = 2000;
let shared: MachineSampler | undefined;
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
function Panel({ title, focused, width, height, panelRef, children }: { title: string; focused: boolean; width?: number; height?: number; panelRef?: (r: never) => void; children: React.ReactNode }) {
  const { c, box, g } = useTheme();
  return (
    <box ref={panelRef} flexDirection="column" paddingX={1} overflow="hidden" minHeight={0} width={width} height={height} flexShrink={width || height ? 0 : 1} flexGrow={width || height ? 0 : 1}
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
export function HomeTab({ store, nav, profile, registry, sampler }: { store: SessionApi; nav: TabsNav; profile?: string | null; registry: Registry; sampler?: MachineSampler }) {
  const slots = registry.slots;
  const { c, g } = useTheme();
  const { cols, rows: termRows, narrow } = useLayout();
  const tabs = useTabs();
  const nudge = useNudge();
  const panels = usePanelNav();
  const focused = tabs?.focused ?? true;
  useScreenScope(nav.home.inside ? "homein" : "home", 1); // inside a panel the footer changes; the tab bar (rank 2) still outranks it
  const { history, blocks } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const machine = useMemo(() => sampler ?? (shared ??= createMachineSampler()), [sampler]);
  const [m, setM] = useState(() => machine.sample());
  const [now, setNow] = useState(Date.now);
  // The only timer: it exists while Início is mounted.
  useEffect(() => {
    const t = setInterval(() => (setM(machine.sample()), setNow(Date.now())), SAMPLE_MS);
    return () => clearInterval(t);
  }, [machine]);
  // The slot hub's single scheduler runs while Início is mounted; its changes re-render here.
  const makeLogger = usePages()?.makeLogger;
  useEffect(() => {
    const off = slots.subscribe(bump);
    const stop = slots.start(makeLogger?.("core") ?? { debug() {}, info() {}, warn() {}, error() {} });
    return () => (off(), stop());
  }, [slots]);
  const favorites = useMemo(() => loadFavorites(), []);

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
      ...(done?.ignored ?? []).map((t): Row => ({ id: `ig:${t}`, mark: [g.inactive, c.dim], text: t })),
    ],
    maquina: [],
    notas: slotItems<string>(slots, "home.notes").map((t, i): Row => ({ id: `note:${i}`, mark: [" ", c.dim], text: clean(t) })),
    atividade: activity(history, blocks, favorites).map((a) => ({
      id: a.id,
      mark: a.favorite ? [g.favorite, c.warn] : a.status === "error" ? [g.error, c.error] : a.status === "warn" ? [g.warn, c.warn] : a.status === "ok" ? [g.ok, c.accent] : [" ", c.dim],
      text: clean(a.line),
      note: a.at ? relTime(a.at, now) : undefined,
      use: a.line,
    })),
  };
  // The notes panel exists only while the slot has data; it is the 3rd navigable panel.
  const PANELS: readonly HomePanel[] = rows.notas.length ? [...BASE_PANELS, "notas"] : BASE_PANELS;
  const cur = (p: HomePanel) => rows[p].find((r) => r.id === nav.home.sel[p]) ?? rows[p][0];
  const select = (p: HomePanel, id: string) => (nav.home.sel[p] = id, nav.home.panel = p, nav.home.inside = true, bump());
  const use = (r?: Row) => {
    if (!r?.use) return;
    nav.draft = r.use;
    tabs?.goto("comando");
  };
  const refresh = () => (conf.refresh(), void slots.refresh());
  // `n` on Início opens the composer of whichever module declared the roles: the page with role `notes` and the `compose` query.
  const notesPage = pageWithRole(registry, "notes");
  const compose = registry.roles.get("compose")?.name;
  const hasNotes = Boolean(notesPage && compose);
  const goNotes = () => notesPage && void store.run(`#${notesPage.key}`); // a pushed page, not a tab

  useKeys((k) => {
    if (!focused) return;
    const p = nav.home.panel === "maquina" || PANELS.includes(nav.home.panel) ? nav.home.panel : PANELS[0]!; // the notes panel can go away
    const key = k.name === "left" || k.name === "right" || k.name === "up" || k.name === "down" ? k.name : matchKey(k, "enter") ? "enter" : matchKey(k, "esc") ? "esc" : undefined;
    const step = key && panelStep({ panel: p, inside: nav.home.inside }, key, (from, dir) => panels.pick(from, dir), (q) => rows[q as HomePanel].length);
    if (step) {
      if (step.bar) return tabs?.focusBar(), true;
      if (step.nudge) return nudge(step.nudge), true;
      if (step.move) {
        const i = rows[p].findIndex((r) => r.id === cur(p)?.id);
        const to = rows[p][i + step.move];
        return to ? select(p, to.id) : nudge(step.move < 0 ? "início da lista" : "fim da lista"), true;
      }
      if (step.act) return p === "notas" ? goNotes() : use(cur(p)), true;
      nav.home.panel = step.panel as HomePanel;
      nav.home.inside = step.inside;
      return bump(), true;
    }
    const n = PANELS[Number(k.sequence) - 1];
    if (n && !k.ctrl) return nav.home.panel = n, nav.home.inside = false, bump(), true;
    if (matchKey(k, "n") && hasNotes) return void registry.query(compose!), goNotes(), true;
    if (matchKey(k, "r")) return refresh(), true;
    if (k.sequence === "/") return tabs?.goto("comando"), true;
  });

  const machW = machWidth(cols);
  const confW = narrow ? cols - 2 : cols - 2 - machW;

  const total = done?.total ?? 0;
  const pct = total ? (done!.ok / total) * 100 : 0;
  const [cf, ce] = meter(pct, 10, g);
  const worst = attention.some((p) => p.level === "error") ? c.error : c.warn;
  const conformidade = (
    <Panel panelRef={panels.ref("conformidade")} title={`[${PANELS.indexOf("conformidade") + 1}] conformidade`} focused={focused && nav.home.panel === "conformidade"}>
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
      <Rows rows={rows.conformidade} sel={cur("conformidade")?.id} focused={focused && nav.home.panel === "conformidade" && nav.home.inside} w={confW - 4} onPick={(r) => (select("conformidade", r.id), use(r))} />
    </Panel>
  );
  const notas = (
    <Panel panelRef={panels.ref("notas")} title={`[${PANELS.indexOf("notas") + 1}] notas`} focused={focused && nav.home.panel === "notas"} height={Math.min(rows.notas.length, 3) + 2}>
      <Rows rows={rows.notas} sel={cur("notas")?.id} focused={focused && nav.home.panel === "notas" && nav.home.inside} w={cols - 6} onPick={() => goNotes()} />
    </Panel>
  );
  // The card takes its full height unless the other panels would starve; then rows drop by priority (see planCard).
  const innerW = (narrow ? cols - 2 : machW) - 4;
  const notasH = rows.notas.length ? Math.min(rows.notas.length, 3) + 2 : 0;
  const avail = termRows - 2 - (chips.length || brokenChips.length ? 1 : 0) - notasH;
  const cardRows = (max: number) => planCard(m.cpu.cores.length, innerW, max).rows;
  const machH = Math.max(cardRows(0), Math.min(cardRows(Infinity), avail - (narrow ? 9 : 5) - 2)) + 2; // the always-kept rows are the floor
  const tone: Record<Tone, string> = { dim: c.dim, text: c.text, accent: c.accent, warn: c.warn, error: c.error, info: c.info };
  const maquina = (
    <Panel panelRef={panels.ref("maquina")} title="máquina" focused={focused && nav.home.panel === "maquina"} width={narrow ? undefined : machW} height={machH}>
      {machineCard(m, innerW, machH - 2, g).map((line, i) => (
        <text key={i} wrapMode="none" flexShrink={0}>
          {line.map(([t, k, bold], j) => <span key={j} fg={tone[k]}>{bold ? <b>{t}</b> : t}</span>)}
        </text>
      ))}
    </Panel>
  );
  const atividade = (
    <Panel panelRef={panels.ref("atividade")} title={`[${PANELS.indexOf("atividade") + 1}] atividade`} focused={focused && nav.home.panel === "atividade"}>
      {rows.atividade.length ? null : <text fg={c.dim} flexShrink={0}>nada executado ainda</text>}
      <Rows rows={rows.atividade} sel={cur("atividade")?.id} focused={focused && nav.home.panel === "atividade" && nav.home.inside} w={cols - 6} onPick={(r) => (select("atividade", r.id), use(r))} />
    </Panel>
  );

  // Top row: máquina | conformidade (as tall as the card); atividade below, full width. Narrow: one column. The areas share the height; each panel clips.
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
        <>{maquina}{conformidade}{atividade}{rows.notas.length ? notas : null}</>
      ) : (
        <>
          <box height={machH} flexShrink={0} flexDirection="row">{maquina}{conformidade}</box>
          <box flexGrow={1} flexBasis={0} minHeight={4} flexDirection="column">{atividade}</box>
          {rows.notas.length ? notas : null}
        </>
      )}
    </box>
  );
}
