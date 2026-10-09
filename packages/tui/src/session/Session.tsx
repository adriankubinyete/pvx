import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRenderer } from "@opentui/react";
import { createClipboard, createHostClipboard, createRendererClipboardAdapter, type ScrollBoxRenderable } from "@opentui/core";
import type { Registry } from "@pvx/core";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useRouter } from "../router.tsx";
import { useTheme } from "../theme-context.tsx";
import { BlockView } from "./Blocks.tsx";
import { complete, rank, type Candidate } from "./complete.ts";
import { LogScreen } from "./LogScreen.tsx";
import { SessionModals } from "./Modals.tsx";
import type { Block, SessionApi } from "./store.ts";

const printable = (s: string) => [...s].length === 1 && s >= " " && s !== "\x7f";

function Popup({ items, sel }: { items: Candidate[]; sel: number }) {
  const { c, box, g } = useTheme();
  return (
    <box flexDirection="column" flexShrink={0} {...box()}>
      {items.map((it, i) => (
        <box key={it.label} flexDirection="row" justifyContent="space-between" paddingX={1} flexShrink={0} backgroundColor={i === sel ? c.selected : undefined}>
          <text>
            <span fg={c.accent}>{i === sel ? `${g.cursor} ` : "  "}</span>
            <span fg={c.text}>{it.label.slice(0, it.range[0])}</span>
            <span fg={c.accent}><b><u>{it.label.slice(...it.range)}</u></b></span>
            <span fg={c.text}>{it.label.slice(it.range[1])}</span>
            {it.usage ? <span fg={c.dim}>{`   ${it.usage}`}</span> : null}
            {it.destructive ? <span fg={c.error}>{"  ! destrutivo"}</span> : null}
          </text>
          <text fg={c.dim}>{it.help ?? ""}</text>
        </box>
      ))}
    </box>
  );
}

/** The command-first screen. State lives in `store` (the router mounts only the top screen). */
export function Session({ store, registry }: { store: SessionApi; registry: Registry }) {
  const { c, g, box, axes } = useTheme();
  const router = useRouter();
  const renderer = useRenderer();
  const { blocks, history, pending } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [input, setInput] = useState("");
  const [hi, setHi] = useState<number | null>(null);
  const [sel, setSel] = useState(0);
  const [search, setSearch] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const scroll = useRef<ScrollBoxRenderable>(null);

  const searching = search !== null;
  let start = 0;
  let items: Candidate[] = [];
  if (searching) {
    const recent = [...new Set([...history].reverse())];
    items = rank(recent, (l) => l, search).slice(0, 6).map(({ item, range }) => ({ text: item, label: item, range }));
  } else if (hi === null) ({ start, items } = complete(registry, input));
  const at = Math.min(sel, items.length - 1);

  const last = blocks.at(-1);
  const target = last?.status === "error" ? last : undefined;
  useEffect(() => {
    if (last) scroll.current?.scrollChildIntoView(`b${last.id}`);
  }, [last?.id, last?.status]);

  // The spinner's only timer: it exists while a block runs.
  const running = blocks.some((b) => b.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [running]);
  const recall = useCallback((line: string) => (setInput(line), setHi(null), setSel(0)), []);

  const pick = useCallback((b: Block) => recall(store.lineOf(b.id)), [recall, store]);

  const edit = (f: (s: string) => string) => {
    if (searching) setSearch(f(search));
    else setInput(f(input)), setHi(null);
    setSel(0);
  };
  const submit = () => {
    const line = input;
    setInput(""), setHi(null), setSel(0);
    void store.run(line);
  };
  const browse = (to: number | null) => {
    setHi(to);
    setInput(to === null ? "" : history[to] ?? "");
  };

  useKeys((k) => {
    setNote(null);
    if (matchKey(k, "ctrl+l")) return store.clear(), true;
    if (matchKey(k, "ctrl+r")) return setSearch(search ?? ""), setSel(0), true;
    if (k.name === "escape" && (searching || input)) return searching ? setSearch(null) : (setInput(""), setHi(null)), true;
    if (matchKey(k, "enter")) {
      if (!searching) return submit(), true;
      if (items[at]) setInput(items[at].text);
      return setSearch(null), setHi(null), true;
    }
    if (matchKey(k, "tab")) {
      if (!items[at]) return true;
      if (searching) setInput(items[at].text), setSearch(null);
      else setInput(input.slice(0, start) + items[at].text);
      return setSel(0), true;
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
    if (k.name === "backspace") return edit((s) => [...s].slice(0, -1).join("")), true;
    if (!input && !searching && target) {
      if (matchKey(k, "alt+r")) return void store.repeat(target.id), true;
      if (matchKey(k, "alt+l")) return router.push({ id: "log", element: <LogScreen moduleId={target.moduleId} /> }), true;
      if (matchKey(k, "alt+c")) {
        const text = target.lines.filter((l) => l.kind === "error").map((l) => l.text).join("\n");
        // Host + OSC52: the terminal path alone fails under tmux and SSH.
        const clip = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) });
        void clip.writeText(text, { destination: "best-available" }).finally(() => clip.dispose());
        return setNote("copiado"), true;
      }
    }
    if (k.sequence === "?" && !input && !searching) return;
    if (printable(k.sequence) && !k.ctrl && !k.meta) return edit((s) => s + k.sequence), true;
  });

  const hint = note ?? (searching ? "enter escolhe · esc sai" : "tab completa · enter roda");
  const typed = searching ? `(busca) ${search}` : input;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" focused={false} contentOptions={{ gap: 1 }}>
        {blocks.map((b) => <BlockView key={b.id} b={b} actions={b === target} tick={b.status === "running" ? tick : 0} onPick={pick} />)}
      </scrollbox>
      {items.length ? <Popup items={items} sel={at} /> : null}
      <box flexShrink={0} height={axes.border === "none" ? 1 : 3} flexDirection="row" justifyContent="space-between" paddingX={1} {...box(c.accent)}>
        <text>
          <span fg={c.accent}><b>{`${g.prompt} `}</b></span>
          <span fg={c.text}>{typed}</span>
          <span bg={c.accent}>{" "}</span>
        </text>
        <text fg={c.dim}>{hint}</text>
      </box>
      {router.scope === "palette" ? null : <SessionModals store={store} pending={pending} />}
    </box>
  );
}
