import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRenderer } from "@opentui/react";
import { writeClipboard } from "../sdk-ui/copy.tsx";
import type { Registry } from "@pvx/core";
import { hintText, matchKey } from "../keymap.ts";
import { editLine } from "../lineedit.ts";
import { LineText } from "../LineText.tsx";
import { useLayout } from "../layout.ts";
import { followProps, useFollow } from "../follow.ts";
import { useOver } from "../hover.ts";
import { useKeys } from "../keys.tsx";
import { useNudge } from "../nudge.tsx";
import { useRouter, useScreenScope } from "../router.tsx";
import { useTabs } from "../tabs/context.ts";
import { useTheme } from "../theme-context.tsx";
import { BlockView } from "./Blocks.tsx";
import { complete, rank, type Candidate } from "./complete.ts";
import { LogScreen } from "./LogScreen.tsx";
import { SessionModals } from "./Modals.tsx";
import type { Block, SessionApi } from "./store.ts";

const printable = (s: string) => [...s].length === 1 && s >= " " && s !== "\x7f";

/** The suggestion list. `active`: the input owns the keyboard, so hover moves the selection; otherwise hover only tints. A click accepts the row. */
function Popup({ items, sel, active, onHover, onPick }: { items: Candidate[]; sel: number; active: boolean; onHover: (i: number) => void; onPick: (i: number) => void }) {
  const { c, box, g } = useTheme();
  const { over, enter, leave } = useOver<string>();
  return (
    <box flexDirection="column" flexShrink={0} {...box()}>
      {items.map((it, i) => {
        const hot = !active && over === it.label && i !== sel;
        return (
        <box key={it.label} flexDirection="row" justifyContent="space-between" paddingX={1} flexShrink={0} backgroundColor={i === sel ? c.selected : hot ? c.panel : undefined}
          onMouseOver={() => (enter(it.label), active && onHover(i))} onMouseOut={() => leave(it.label)} onMouseDown={(e) => (e.stopPropagation(), onPick(i))}>
          <text>
            {i === sel ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{hot ? `${g.query} ` : "  "}</span>}
            <span fg={c.text}>{it.label.slice(0, it.range[0])}</span>
            <span fg={c.accent}><b><u>{it.label.slice(...it.range)}</u></b></span>
            <span fg={c.text}>{it.label.slice(it.range[1])}</span>
            {it.usage ? <span fg={c.dim}>{`   ${it.usage}`}</span> : null}
            {it.destructive ? <span fg={c.error}>{"  ! destrutivo"}</span> : null}
          </text>
          <text fg={c.dim}>{it.help ?? ""}</text>
        </box>
        );
      })}
    </box>
  );
}

/** The command-first screen. State lives in `store` (the router mounts only the top screen). */
export function Session({ store, registry, draft }: { store: SessionApi; registry: Registry; draft?: { draft: string } }) {
  const { c, g, box, axes } = useTheme();
  const router = useRouter();
  const tabs = useTabs();
  const renderer = useRenderer();
  const nudge = useNudge();
  const { blocks, history, pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [input, setInputRaw] = useState(draft?.draft ?? "");
  // The draft lives outside the component (memory only): the tab switch unmounts this screen.
  // Cursor in code points (`Infinity` = end, clamped on use). Any text set from outside typing (recall, completion, history) lands at the end.
  const [cur, setCur] = useState(Infinity);
  const setInput = useCallback((v: string) => (setInputRaw(v), setCur(Infinity), draft && (draft.draft = v)), [draft]);
  const [hi, setHi] = useState<number | null>(null);
  const [sel, setSel] = useState(0);
  const [search, setSearchRaw] = useState<string | null>(null);
  const setSearch = (v: string | null) => (setSearchRaw(v), setCur(Infinity));
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [fb, setFb] = useState<number | null>(null); // focused block, by id
  const follow = useFollow();
  const inHover = useOver<"input">();

  const searching = search !== null;
  let start = 0;
  let items: Candidate[] = [];
  if (searching) {
    const recent = [...new Set([...history].reverse())];
    items = rank(recent, (l) => l, search).slice(0, 6).map(({ item, range }) => ({ text: item, label: item, range }));
  } else if (hi === null) ({ start, items } = complete(registry, input));
  const at = Math.min(sel, items.length - 1);

  const last = blocks.at(-1);
  const barFocused = tabs?.focused === false;
  const focus = barFocused ? undefined : blocks.find((b) => b.id === fb);
  useScreenScope(barFocused ? "tabs" : focus ? "block" : searching ? "search" : "session", 1);
  useEffect(() => {
    if (barFocused) setFb(null); // coming back from the bar lands in the input
  }, [barFocused]);
  // Moving the focus up leaves the bottom (following pauses); the input or the last block is the bottom again.
  useEffect(() => {
    if (focus && focus !== last) follow.ref.current?.scrollChildIntoView(`b${focus.id}`);
    else follow.toBottom();
  }, [focus?.id]);

  // The spinner's only timer: it exists while a block runs.
  const running = blocks.some((b) => b.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [running]);
  const recall = useCallback((line: string) => (setInput(line), setHi(null), setSel(0)), []);

  const pick = useCallback((b: Block) => (setFb(b.id), tabs?.focusContent()), [tabs]);
  const pickInput = () => (setFb(null), tabs?.focusContent());

  const buffer = searching ? search : input;
  const cursor = Math.min(cur, [...buffer].length);
  const edit = (text: string, at: number) => {
    if (text !== buffer) {
      if (searching) setSearchRaw(text);
      else setInputRaw(text), setHi(null), draft && (draft.draft = text);
      setSel(0);
    }
    setCur(at);
  };
  /** The completion of the keyboard `tab`, also run by a click on a suggestion. */
  const accept = (i: number) => {
    if (!items[i]) return;
    if (searching) setInput(items[i].text), setSearch(null);
    else setInput(input.slice(0, start) + items[i].text);
    setSel(0);
  };
  /** The footer actions of a block, by key: one body for the keyboard and for a click on the hint. */
  const blockAct = (b: Block, key: string) => {
    if (key === "r") return follow.toBottom(), void store.repeat(b.id), true;
    if (key === "x") return b.status === "running" && b.cancellable ? (store.cancel(b.id), true) : false;
    if (key === "l") return router.push({ id: "log", element: <LogScreen moduleId={b.moduleId} /> }), true;
    if (key === "c") {
      const errors = b.lines.filter((l) => l.kind === "error");
      const text = (errors.length ? errors : b.lines).map((l) => l.text).join("\n");
      void writeClipboard(renderer, text);
      return setNote("copiado"), true;
    }
    return false;
  };
  const submit = () => {
    const line = input;
    setInput(""), setHi(null), setSel(0);
    follow.toBottom(); // a new command always shows its own output
    void store.run(line);
  };
  const browse = (to: number | null) => {
    setHi(to);
    setInput(to === null ? "" : history[to] ?? "");
  };

  useKeys((k) => {
    if (tabs?.focused === false) return;
    setNote(null);
    if (k.name === "pageup" || k.name === "pagedown") return follow.page(k.name === "pageup" ? -1 : 1), true;
    if (matchKey(k, "ctrl+l")) return store.clear(), true;
    if (matchKey(k, "ctrl+r")) return setSearch(search ?? ""), setSel(0), true;
    if (k.name === "escape" && (searching || input)) return searching ? setSearch(null) : (setInput(""), setHi(null)), true;
    if (focus && !searching) {
      const i = blocks.indexOf(focus);
      if (k.name === "up") return i > 0 ? setFb(blocks[i - 1]!.id) : (setFb(null), tabs?.focusBar()), true;
      if (k.name === "down") return setFb(blocks[i + 1]?.id ?? null), true;
      if (k.name === "escape") return tabs?.focusBar(), true; // one level up: input -> blocks -> tab bar
      if (matchKey(k, "enter")) return recall(store.lineOf(focus.id)), setFb(null), true;
      for (const key of ["r", "x", "l", "c"]) if (matchKey(k, key) && blockAct(focus, key)) return true;
      if (k.sequence === "?" || k.ctrl) return;
      if (printable(k.sequence) || k.paste !== undefined) setFb(null); // any other letter, or a paste, goes back to the input and types
      else return;
    }
    if (k.name === "escape") return last ? setFb(last.id) : tabs?.focusBar(), true; // empty input: last block, else the tab bar
    if (matchKey(k, "enter")) {
      if (!searching) return submit(), true;
      if (items[at]) setInput(items[at].text);
      return setSearch(null), setHi(null), true;
    }
    if (matchKey(k, "tab")) {
      return accept(at), true;
    }
    if (k.name === "up") {
      if (items.length && at > 0) return setSel(at - 1), true;
      if (!searching && history.length) browse(hi === null ? history.length - 1 : Math.max(0, hi - 1));
      return true;
    }
    if (k.name === "down") {
      if (items.length && at < items.length - 1 && hi === null) return setSel(at + 1), true;
      if (!searching && hi !== null) browse(hi + 1 < history.length ? hi + 1 : null);
      return true;
    }
    if (k.sequence === "?" && !input && !searching) return;
    const r = editLine({ text: buffer, cursor }, k);
    if (r) return r.exit === "left" ? nudge() : edit(r.text, r.cursor), true; // `→` at the end is just the end of the line

  }, { paste: true });

  const hint = note ?? (input.startsWith("!") && !input.startsWith("!!") && !searching ? "host shell · enter roda" : searching ? hintText("search", "enter", "esc") : hintText("session", "tab", "enter"));
  const inputFocused = !barFocused && !focus;
  const shell = !searching && input.startsWith("!") && !input.startsWith("!!"); // host shell mode: the `!` stays visible, deleting it leaves the mode
  const mode = shell ? c.warn : c.accent;
  const lit = inHover.over !== undefined && !inputFocused; // hover on a resting input: subtle frame and prompt, never the focus accent
  const { cols } = useLayout();
  const room = Math.max(10, cols - 12 - [...hint].length - (searching ? 8 : 0));
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
      <scrollbox ref={follow.ref} flexGrow={1} minHeight={0} {...followProps} focused={false} contentOptions={{ gap: 1 }}>
        {blocks.map((b) => <BlockView key={b.id} b={b} focused={b === focus} tick={b.status === "running" ? tick : 0} onPick={pick} onAct={(blk, key) => blockAct(blk, key)} />)}
      </scrollbox>
      {items.length ? <Popup items={items} sel={at} active={inputFocused} onHover={setSel} onPick={(i) => (pickInput(), accept(i))} /> : null}
      <box flexShrink={0} height={axes.border === "none" ? 1 : 3} flexDirection="row" justifyContent="space-between" paddingX={1} onMouseOver={() => inHover.enter("input")} onMouseOut={() => inHover.leave("input")} onMouseDown={pickInput} {...box(inputFocused ? mode : lit ? c.text : undefined)}>
        <text>
          <span fg={inputFocused ? mode : lit ? c.text : c.dim}><b>{`${shell ? g.shell : g.prompt} `}</b></span>
          {searching ? <span fg={c.text}>(busca) </span> : null}
          {buffer || inputFocused ? <LineText line={{ text: buffer, cursor }} focused={inputFocused} width={room} fg={shell ? c.warn : undefined} /> : <span fg={c.dim}>digite um comando · !ls para o shell · sem segredos</span>}
        </text>
        <text fg={c.dim}>{hint}</text>
      </box>
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}
