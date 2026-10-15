import { useEffect, useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { jobOfEntry, listTasks, type LogLevel, type Registry } from "@pvx/core";
import { followProps } from "../follow.ts";
import { matchKey } from "../keymap.ts";
import { editLine, lineOf, type Line } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useKeys, type RoutedKey } from "../keys.tsx";
import { useNudge } from "../nudge.tsx";
import { useScreenScope } from "../router.tsx";
import { useOver } from "../hover.ts";
import { Chip } from "../sdk-ui/kit.tsx";
import { useCopy } from "../sdk-ui/copy.tsx";
import type { SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { useTabs } from "./context.ts";
import { LogRowView } from "./LogRows.tsx";
import { ALL_SOURCES, AUDIT_SOURCE, filterEntries, groupByDay, jobHint, levelChipLabel, MAX_SHOWN, nextLevel, phaseAt, sourceChips, sourceLabel, stepSource, withIds, type LogLine } from "./logs-view.ts";
import { useLogEntries } from "./useLogEntries.ts";

/** What the Logs tab remembers across a tab switch (the tab unmounts): the chips, the search and which log. */
export interface LogsNav {
  source: string;
  level: LogLevel;
  search: string;
  audit: boolean;
}
export const createLogsNav = (): LogsNav => ({ source: ALL_SOURCES, level: "info", search: "", audit: false });

const PAGE_ROWS = 10;
const SEARCH_WIDTH = 24;
const LIVE_WORD = "ao vivo";
const PAUSED_WORD = "pausado";

/** Logs: every log of the central merged, with chips for the source and the level, a search, and the line under the cursor opened with enter. */
export function LogsTab({ store, registry, nav, refreshMs }: { store: SessionApi; registry: Registry; nav: LogsNav; refreshMs?: number }) {
  const { c, g } = useTheme();
  const tabs = useTabs();
  const nudge = useNudge();
  const copy = useCopy();
  const focused = tabs?.focused ?? true;
  const [, redraw] = useState(0);
  const update = (patch: Partial<LogsNav>) => (Object.assign(nav, patch), redraw((n) => n + 1));
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [live, setLive] = useState(true);
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState<Line | null>(null); // the search being typed
  const over = useOver();
  const scroll = useRef<ScrollBoxRenderable>(null);
  useScreenScope(search ? "logsearch" : "logs", 1);

  const entries = useLogEntries(nav.audit, refreshMs);
  const chips = useMemo(() => sourceChips(entries, [...registry.modules.keys()]), [entries, registry.modules.size]);
  const source = chips.includes(nav.source) ? nav.source : ALL_SOURCES;
  const lines = useMemo(() => withIds(filterEntries(entries, { source, level: nav.level, search: nav.search }).slice(-MAX_SHOWN)), [entries, source, nav.level, nav.search]);
  const currentLine: LogLine | undefined = live ? lines.at(-1) : lines.find((line) => line.id === selected) ?? lines.at(-1);
  const rows = useMemo(() => groupByDay(lines, Date.now()), [lines]);

  useEffect(() => {
    if (live) scroll.current?.scrollTo(scroll.current.scrollHeight);
    else if (currentLine) scroll.current?.scrollChildIntoView(`log:${currentLine.id}`);
  }, [currentLine?.id, live, opened]);

  const select = (id: string | undefined) => {
    setSelected(id);
    setLive(id === lines.at(-1)?.id);
    setOpened(false);
  };
  const move = (delta: number) => {
    const index = lines.findIndex((line) => line.id === currentLine?.id) + delta;
    if (index < 0) return lines.length ? select(lines[0]!.id) : tabs?.focusBar();
    select(lines[Math.min(index, lines.length - 1)]?.id);
  };
  const goLive = () => (select(lines.at(-1)?.id), setLive(true));
  const copyLine = () => {
    if (!currentLine) return nudge("nada aqui");
    void copy(currentLine.entry.raw, { title: "linha copiada" });
  };
  /** `enter` on a line of a job opens the job's log; on any other, its details. */
  const enter = () => {
    if (!currentLine) return nudge("nada aqui");
    const job = jobOfEntry(currentLine.entry);
    if (!job) return setOpened(!opened);
    void store.run(`jobs log ${job.module} ${job.name}`);
    tabs?.goto("comando");
  };
  const stepChip = (delta: number) => update({ source: stepSource(chips, source, delta) });
  const toggleAudit = () => (update({ audit: !nav.audit, source: ALL_SOURCES }), select(undefined), setLive(true));

  const editSearch = (key: RoutedKey) => {
    if (matchKey(key, "esc")) return update({ search: "" }), setSearch(null), true;
    if (matchKey(key, "enter")) return update({ search: search!.text }), setSearch(null), true;
    const edited = editLine(search!, key);
    if (!edited) return undefined;
    setSearch({ text: edited.text, cursor: edited.cursor });
    update({ search: edited.text });
    return true;
  };
  const onKey = (key: RoutedKey) => {
    if (key.name === "up") return move(-1), true;
    if (key.name === "down") return move(1), true;
    if (key.name === "pageup" || key.name === "pagedown") return move(key.name === "pageup" ? -PAGE_ROWS : PAGE_ROWS), true;
    if (key.name === "home") return select(lines[0]?.id), true;
    if (key.name === "end") return goLive(), true;
    if (key.name === "left" || key.name === "right") return stepChip(key.name === "left" ? -1 : 1), true;
    if (matchKey(key, "n")) return update({ level: nextLevel(nav.level) }), true;
    if (key.sequence === "/") return setSearch(lineOf(nav.search)), true;
    if (matchKey(key, "enter")) return enter(), true;
    if (matchKey(key, "c")) return copyLine(), true;
    if (matchKey(key, "a")) return toggleAudit(), true;
    if (matchKey(key, "esc")) return (nav.search ? update({ search: "" }) : tabs?.focusBar()), true;
  };
  useKeys((key) => (!focused ? undefined : search ? editSearch(key) : onKey(key)), { paste: true });

  const job = currentLine && jobOfEntry(currentLine.entry);
  const hint = useMemo(() => {
    if (!job) return undefined;
    const task = listTasks().find((candidate) => candidate.module === job.module && candidate.name === job.name);
    return jobHint(job.name, task && currentLine ? phaseAt(task, currentLine.entry.at) : undefined);
  }, [job?.module, job?.name, currentLine?.id]);
  const sourceWidth = Math.min(14, Math.max(0, ...lines.map((line) => [...sourceLabel(line.entry.source)].length)));

  const chipsLine = (
    <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingX={1}>
      <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={1}>
        {nav.audit
          ? <Chip label={AUDIT_SOURCE} state="on" onPress={toggleAudit} />
          : chips.map((chip) => <Chip key={chip} label={chip === ALL_SOURCES ? chip : sourceLabel(chip)} state={chip === source ? "on" : "off"} onPress={() => update({ source: chip })} />)}
        <text wrapMode="none" fg={c.dim} flexShrink={0}>{" nível"}</text>
        <Chip label={levelChipLabel(nav.level)} state="off" onPress={() => update({ level: nextLevel(nav.level) })} />
        {search ? (
          <text wrapMode="none" flexShrink={0}><span fg={c.accent}>{"/ "}</span><LineText line={search} focused width={SEARCH_WIDTH} /></text>
        ) : <text wrapMode="none" fg={nav.search ? c.text : c.dim} flexShrink={0} onMouseDown={() => setSearch(lineOf(nav.search))}>{nav.search ? `/ ${nav.search}` : "/ buscar"}</text>}
      </box>
      <text wrapMode="none" flexShrink={0} fg={live ? c.accent : c.dim} onMouseDown={goLive}>{live ? `${g.active} ${LIVE_WORD}` : `${g.inactive} ${PAUSED_WORD}`}</text>
    </box>
  );
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      {chipsLine}
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} {...followProps} focused={false}>
        <box flexDirection="column" paddingX={1} flexShrink={0}>
          {rows.length === 0 ? <text wrapMode="none" fg={c.dim} flexShrink={0}>{nav.search || nav.level !== "info" || source !== ALL_SOURCES ? "nada com este filtro" : "sem registros"}</text> : null}
          {rows.map((row) => row.kind === "day"
            ? <text key={row.id} wrapMode="none" flexShrink={0} fg={c.dim}>{row.label}</text>
            : <LogRowView key={row.id} line={row.line} on={focused && row.line.id === currentLine?.id} current={row.line.id === currentLine?.id} lit={over.over === row.id} opened={opened && row.line.id === currentLine?.id} hint={row.line.id === currentLine?.id ? hint : undefined} sourceWidth={sourceWidth} onOver={over.enter} onOut={over.leave} onPick={(line) => select(line.id)} />)}
        </box>
      </scrollbox>
    </box>
  );
}
