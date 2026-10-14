import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { OutLine } from "@pvx/sdk";
import { codeDiff, listCode, readCode, reviewModule, trustModule, updateLines, updateModule, usermodulesDir, type PermDiff, type Registry, type Review, type UpdateCheck } from "@pvx/core";
import { join } from "node:path";
import { addPageRow, matchKey, reviewRows } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { useLayout } from "../layout.ts";
import { Result } from "../menu/Result.tsx";
import { useNudge } from "../nudge.tsx";
import { clean } from "../palette/search.ts";
import { useRouter, useScreenScope } from "../router.tsx";
import { sanitize, type SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { deliveredTail, reloadAndReport } from "./actions.ts";
import type { ModulesDeps } from "./deps.ts";
import { deliverySegs, fileRows, fmtWhen, hitGroups, linesText, repoOf, rulerMarks, type FileRow, type Seg } from "./review-view.ts";

const list = (a?: string[]) => (a?.length ? a.map(clean).join(", ") : "nada");
const sha7 = (s: string) => s.slice(0, 7);
const PERM_KINDS = ["exec", "net", "fs"] as const;

function Row({ k, tone, children }: { k: string; tone?: "warn" | "error" | "accent"; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <box flexDirection="row" flexShrink={0}>
      <box width={16} flexShrink={0}><text fg={c.dim}>{k}</text></box>
      <box flexGrow={1} flexShrink={1}><text fg={tone ? c[tone] : c.text}>{children}</text></box>
    </box>
  );
}

/** Requested permissions (trust) or the change against the approved ones (update). Added ones are highlighted. */
function Perms({ review, diff }: { review?: Review; diff?: PermDiff }) {
  if (diff) {
    const rows = (["added", "removed"] as const).flatMap((w) => Object.entries(diff[w]).map(([k, v]) => ({ w, k, v: v as string[] })));
    if (!rows.length) return <Row k="permissões">sem mudança</Row>;
    return <>{rows.map((r) => <Row key={r.w + r.k} k={r === rows[0] ? "permissões" : ""} tone={r.w === "added" ? "warn" : undefined}>{`${r.w === "added" ? "ADICIONADAS" : "removidas"} ${r.k}: ${list(r.v)}`}</Row>)}</>;
  }
  const p = review!.permissions;
  const asked = PERM_KINDS.filter((k) => p[k]?.length);
  if (!asked.length) return <Row k="permissões">nenhuma (declarativas, não é sandbox)</Row>;
  return <>{asked.map((k, i) => <Row key={k} k={i ? "" : "pede permissão"}>{`${k} ${list(p[k])}${i === asked.length - 1 ? "  (declarativas, não é sandbox)" : ""}`}</Row>)}</>;
}

/**
 * Module files, then one file as plain read-only text. Update mode shows the diff of the new commits as the single "file".
 * `start` opens a file at once, scrolled to `line`, and esc leaves the browser from it. `marks` adds a gutter with line numbers and a ▲ on the lines it returns.
 */
function CodeBrowser({ files, read, onBack, start, marks }: { files: string[]; read: (f: string) => Promise<string> | string; onBack: () => void; start?: { file: string; line: number }; marks?: (file: string) => number[] }) {
  const { c, box, g } = useTheme();
  useScreenScope("files", 2);
  const scroll = useRef<ScrollBoxRenderable>(null);
  const [sel, setSel] = useState(files[0]);
  const [open, setOpen] = useState<{ name: string; lines: string[] } | null>(null);
  const i = Math.max(0, files.indexOf(sel ?? ""));
  useEffect(() => void (sel && !open && scroll.current?.scrollChildIntoView(sel)), [sel, open]);
  useEffect(() => void (start && show(start.file)), []);
  // The scrollbox only knows its content height after a layout pass.
  useEffect(() => {
    if (!open || !start) return;
    const to = () => scroll.current?.scrollTo(Math.max(0, start.line - 4));
    to();
    const t = setTimeout(to, 30);
    return () => clearTimeout(t);
  }, [open?.name]);
  const show = async (name: string) => {
    let text: string;
    try {
      text = await read(name);
    } catch (e) {
      text = `não foi possível ler: ${(e as Error).message}`;
    }
    setOpen({ name, lines: sanitize(text).slice(0, 2000) });
  };
  useKeys((k) => {
    if (k.name === "escape") return open && !start ? setOpen(null) : onBack(), true;
    if (open) {
      const d = k.name === "up" ? -1 : k.name === "down" ? 1 : k.name === "pageup" ? -10 : k.name === "pagedown" ? 10 : 0;
      return d ? (scroll.current?.scrollBy(d), true) : true;
    }
    if (k.name === "up" || k.name === "down") return setSel(files[Math.max(0, Math.min(files.length - 1, i + (k.name === "up" ? -1 : 1)))]), true;
    if (matchKey(k, "enter") && sel) return void show(sel), true;
    return true; // a modal-like view: nothing leaks to the review under it
  });
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} ${open ? clean(open.name) : "código · só leitura"}`}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
        {open ? (
          <box flexDirection="row" flexShrink={0}>
            {marks ? <Gutter n={open.lines.length} marked={new Set(marks(open.name))} /> : null}
            <text fg={c.text} wrapMode="none">{open.lines.join("\n")}</text>
          </box>
        ) : start ? <text fg={c.dim}>lendo…</text>
          : files.length
            ? files.map((f) => <box key={f} id={f} flexShrink={0} paddingX={1} backgroundColor={f === sel ? c.selected : undefined}><text fg={f === sel ? c.accent : c.text}>{`${f === sel ? g.cursor : " "} ${clean(f)}`}</text></box>)
            : <text fg={c.dim}>sem arquivos</text>}
      </scrollbox>
    </box>
  );
}

/** Line numbers; the `marked` ones get a warn ▲. */
function Gutter({ n, marked }: { n: number; marked: Set<number> }) {
  const { c, g } = useTheme();
  const w = String(n).length;
  return (
    <box width={w + 3} flexShrink={0}>
      <text wrapMode="none">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} fg={marked.has(i + 1) ? c.warn : c.dim}>{`${String(i + 1).padStart(w)} ${marked.has(i + 1) ? g.warn : " "}${i < n - 1 ? "\n" : ""}`}</span>
        ))}
      </text>
    </box>
  );
}

/** Left and right ends of a line; when they do not fit, the `cut` side gives way. */
function Split({ left, right, cut = "left" }: { left: ReactNode; right?: ReactNode; cut?: "left" | "right" }) {
  return (
    <box flexDirection="row" flexShrink={0} justifyContent="space-between">
      <box flexShrink={cut === "left" ? 1 : 0} minWidth={0} overflow="hidden">{left}</box>
      {right ? <box flexShrink={cut === "right" ? 1 : 0} minWidth={0} overflow="hidden" paddingLeft={2}>{right}</box> : null}
    </box>
  );
}

/** The commit being approved: who, when, what, and whether this origin was approved before. */
function Banner({ r }: { r: Review }) {
  const { c, g } = useTheme();
  const k = r.commit;
  return (
    <box flexDirection="row" flexShrink={0} backgroundColor={c.panel}>
      <box width={1} flexShrink={0}><text fg={c.info}>{"▌\n▌\n▌"}</text></box>
      <box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="column" paddingX={1}>
        <Split cut="right"
          left={<text wrapMode="none"><span fg={c.info}><b>{k.short}</b></span><span fg={c.dim}>{k.sha.slice(k.short.length)}</span></text>}
          right={<text wrapMode="none" fg={c.dim}>{`${r.ref ? `branch ${clean(r.ref)} ${g.sep} ` : ""}${clean(repoOf(r.url))}`}</text>}
        />
        <text wrapMode="none" fg={c.text}><b>{clean(k.subject)}</b></text>
        <Split
          left={<text wrapMode="none" fg={c.dim}>{`${clean(k.author)} ${g.sep} ${fmtWhen(k.date)} ${g.sep} ${k.count} ${k.count === 1 ? "commit" : "commits"} no histórico`}</text>}
          right={r.trustedBefore
            ? <text wrapMode="none" fg={c.dim}>{`${g.official} aprovado antes: ${sha7(r.trustedBefore)}`}</text>
            : <text wrapMode="none" fg={c.warn}>{`${g.official} primeira aprovação`}</text>}
        />
      </box>
    </box>
  );
}

/** Compatibility chips, what the module asks for and what it ships: three lines, no code. */
function Strip({ r }: { r: Review }) {
  const { c, g } = useTheme();
  const tone = { text: c.text, info: c.info, dim: c.dim } as const;
  const chip = (ok: boolean, text: string, key: string) => (
    <span key={key}>
      <span fg={ok ? c.accent : c.error}>{ok ? g.ok : g.error}</span>
      <span fg={ok ? c.text : c.error}>{` ${text}   `}</span>
    </span>
  );
  const p = r.platform;
  const sum = r.permissionSummary;
  const delivery: Seg[] = deliverySegs(r.commandSummary, r.contributes.pages?.length ?? 0, r.contributes.widgets?.length ?? 0);
  const label = (s: string) => <box width={9} flexShrink={0}><text fg={c.dim}>{s}</text></box>;
  return (
    <box flexDirection="column" flexShrink={0} paddingX={1}>
      <Split
        left={
          <text wrapMode="none">
            {chip(r.compat.ok, `pvx ${clean(r.manifest.pvx ?? "qualquer versão")}`, "pvx")}
            {chip(p.ok, p.ok ? clean(p.wanted) : `só ${clean(p.wanted)} ${g.sep} aqui é ${clean(p.host)}`, "os")}
            {chip(!r.conflicts.length, r.conflicts.length ? `${r.conflicts.length} ${r.conflicts.length === 1 ? "conflito" : "conflitos"}` : "sem conflitos", "cf")}
          </text>
        }
        right={<text wrapMode="none" fg={c.warn}>{`${g.warn} roda como root`}</text>}
      />
      <box flexDirection="row" flexShrink={0}>
        {label("pede")}
        <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <text wrapMode="none">
            {sum.broad.map((b) => <span key={b} fg={c.warn}>{`${g.warn} ${clean(b)}  `}</span>)}
            <span fg={c.dim}>{[sum.commonCount ? `+ ${sum.commonCount} ${sum.commonCount === 1 ? "comum" : "comuns"}` : "", sum.net.length ? sum.net.map(clean).join(", ") : "sem rede"].filter(Boolean).join(` ${g.sep} `)}  </span>
            <span fg={c.accent}>p</span>
            <span fg={c.dim}> tudo</span>
          </text>
        </box>
      </box>
      <box flexDirection="row" flexShrink={0}>
        {label("entrega")}
        <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <text wrapMode="none">
            {delivery.length ? delivery.map(([t, k], i) => <span key={i} fg={tone[k]}>{t}</span>) : <span fg={c.dim}>nada</span>}
          </text>
        </box>
      </box>
    </box>
  );
}

/** A bordered pane; `grow` is its share of the free space. Focused: accent border and a ● after the title. */
function Pane({ title, right, focused, grow, children }: { title: string; right?: string; focused?: boolean; grow: number; children: ReactNode }) {
  const { c, box, g } = useTheme();
  return (
    <box flexDirection="column" flexGrow={grow} flexBasis={0} flexShrink={1} minHeight={0} minWidth={0} {...box(focused ? c.accent : undefined)} title={`${g.query} ${title}${focused ? ` ${g.active}` : ""}`}>
      {right ? <box position="absolute" top={-1} right={2} backgroundColor={c.bg}><text wrapMode="none" fg={c.dim}>{` ${right} `}</text></box> : null}
      {children}
    </box>
  );
}

function Files({ rows, sel, total, grow }: { rows: FileRow[]; sel?: string; total: { files: number; lines: number }; grow: number }) {
  const { c, g } = useTheme();
  const scroll = useRef<ScrollBoxRenderable>(null);
  const top = rows.find((r) => r.kind === "file");
  // Up to the first file scrolls to the very top, so its group header shows.
  useEffect(() => void (sel && (top?.kind === "file" && top.file.path === sel ? scroll.current?.scrollTo(0) : scroll.current?.scrollChildIntoView(`f:${sel}`))), [sel]);
  return (
    <Pane title="arquivos" right={`${total.files} ${total.files === 1 ? "arquivo" : "arquivos"} ${g.sep} ${total.lines} linhas`} focused grow={grow}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
        {rows.length ? rows.map((r) => r.kind === "head" ? (
          <box key={`h:${r.group}`} id={`h:${r.group}`} flexDirection="row" flexShrink={0} paddingX={1}>
            <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <text wrapMode="none"><span fg={c.dim}>▾ </span><span fg={c.text}><b>{clean(r.group === "." ? "(raiz)" : r.group)}</b></span><span fg={c.dim}>{`  ${r.count} ${g.sep} ${r.lines} linhas`}</span></text>
            </box>
            <box flexShrink={0} paddingLeft={1}>
              <text wrapMode="none" fg={r.hits ? c.warn : c.accent}>{r.hits ? `${g.warn} ${r.hits} ${r.hits === 1 ? "aviso" : "avisos"}` : `${g.ok} limpo`}</text>
            </box>
          </box>
        ) : (
          <box key={`f:${r.file.path}`} id={`f:${r.file.path}`} flexDirection="row" flexShrink={0} paddingX={1} backgroundColor={r.file.path === sel ? c.selected : undefined}>
            <box width={4} flexShrink={0}><text fg={c.accent}>{r.file.path === sel ? `  ${g.cursor}` : ""}</text></box>
            <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden"><text wrapMode="none" fg={c.text}>{clean(r.name)}</text></box>
            <box width={7} flexShrink={0} justifyContent="flex-end"><text fg={c.dim}>{String(r.file.lines)}</text></box>
            <box width={8} flexShrink={0} paddingLeft={2}><text fg={c.info}>{r.file.entry ? "entry" : ""}</text></box>
            <box width={4} flexShrink={0}><text fg={c.warn}>{r.file.hits.length ? `${g.warn} ${r.file.hits.length}` : ""}</text></box>
          </box>
        )) : <box paddingX={1} flexShrink={0}><text fg={c.dim}>nenhum arquivo de código</text></box>}
      </scrollbox>
    </Pane>
  );
}

/** What the selected file is, who uses it and where the analysis flagged it; never its text. */
function Details({ f, grow, inner }: { f?: Review["files"][number]; grow: number; inner: number }) {
  const { c, g } = useTheme();
  if (!f) return <Pane title="detalhes" grow={grow}><box paddingX={1}><text fg={c.dim}>sem arquivo selecionado</text></box></Pane>;
  const by = f.importedBy.length > 3 ? `${f.importedBy.slice(0, 3).join(", ")} +${f.importedBy.length - 3}` : f.importedBy.join(", ");
  const groups = hitGroups(f.hits);
  const marks = rulerMarks(f.lines, f.hits.map((h) => h.line), Math.max(8, Math.min(40, inner - String(f.lines).length - 4)));
  const first = f.hits.length ? Math.min(...f.hits.map((h) => h.line)) : 1;
  return (
    <Pane title={`detalhes ${g.sep} ${clean(f.path)}`} grow={grow}>
      <box flexDirection="column" flexGrow={1} minHeight={0} paddingX={1} overflow="hidden">
        <Row k="tamanho">{`${f.lines} ${f.lines === 1 ? "linha" : "linhas"}`}</Row>
        <Row k="importado por">{f.importedBy.length ? clean(by) : "ninguém"}</Row>
        <Row k="módulo usa?" tone={!f.used && f.hits.length ? "accent" : undefined}>{f.entry ? "sim (entry)" : f.used ? "sim" : `não ${g.sep} fora do caminho do entry`}</Row>
        {groups.length ? (
          <box flexDirection="column" flexShrink={0} paddingTop={1}>
            {groups.map((x) => (
              <box key={x.msg} flexDirection="column" flexShrink={0}>
                <text wrapMode="none" fg={c.warn}>{`${g.warn} ${clean(x.msg)}`}</text>
                <text wrapMode="none" fg={c.dim}>{`  ${linesText(x.lines)}`}</text>
              </box>
            ))}
            <text wrapMode="none">
              <span fg={c.dim}>1 </span>
              {marks.map((on, i) => <span key={i} fg={on ? c.warn : c.border}>{on ? g.active : g.hline}</span>)}
              <span fg={c.dim}>{` ${f.lines}`}</span>
            </text>
          </box>
        ) : null}
        <box flexGrow={1} />
        <text wrapMode="none" fg={c.dim}>{`enter abre no editor na linha ${first}`}</text>
      </box>
    </Pane>
  );
}

export interface ReviewProps {
  id: string;
  store: SessionApi;
  registry: Registry;
  deps: ModulesDeps;
  /** Update mode: the fetched check (commits, permission diff). Absent: first-time trust. */
  update?: UpdateCheck;
  /** Called before the screen pops after a successful approval, so the opener can select the module's row. Absent: the result screen shows instead. */
  onDone?: (id: string) => void;
}

/** The trust review (spec "Tela de revisão"), pushed on the router; the same screen shows an update. Approving runs as a block. */
export function ReviewScreen({ id, store, registry, deps, update, onDone }: ReviewProps) {
  const { c, box, g } = useTheme();
  const router = useRouter();
  const nudge = useNudge();
  const { cols, narrow } = useLayout();
  const dir = join(usermodulesDir(), id);
  const scroll = useRef<ScrollBoxRenderable>(null);
  const [review, setReview] = useState<Review>();
  const [err, setErr] = useState("");
  const [view, setView] = useState<"full" | "perms" | "code">("full");
  const [files, setFiles] = useState<string[]>([]);
  const [start, setStart] = useState<{ file: string; line: number }>();
  const [selPath, setSelPath] = useState<string>();
  const [done, setDone] = useState<number>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (update) return;
    reviewModule(dir, { hostVersion: deps.load.hostVersion, registry, reserved: deps.reserved }).then(setReview, (e) => setErr((e as Error).message));
  }, []);

  const sha = update ? update.remoteSha : review?.sha;
  useEffect(() => {
    const off = reviewRows(Boolean(update), sha && sha7(sha)).map((r) => addPageRow("review", r));
    return () => off.forEach((f) => f());
  }, [Boolean(update), sha && sha7(sha)]);

  const all = review?.files ?? [];
  const rows = useMemo(() => fileRows(all), [review]);
  const cur = all.find((f) => f.path === selPath) ?? all[0];

  /** `always`: also trust every later commit from this origin. */
  const approve = async (always = false) => {
    if (!sha || busy) return;
    setBusy(true);
    const line = update ? `modules update ${id} --trust ${sha7(sha)}` : `modules trust ${id} --sha ${sha7(sha)}${always ? " --always" : ""}`;
    const r = await store.act(line, async () => {
      let lines: OutLine[] = [];
      if (update) {
        const u = await updateModule(id, { trust: sha, allowFile: deps.allowFile });
        if (!u.ok) return { exit: 1, lines: updateLines(u) };
        lines = updateLines(u);
      } else {
        const t = await trustModule(id, sha, always ? { always: true } : {});
        if (!t.ok) return { exit: 1, lines: [{ kind: "error", text: t.error }] };
      }
      const l = await reloadAndReport(registry, deps, id, update ? "atualizado" : "aprovado");
      return { exit: l.exit, lines: [...lines.filter((x) => x.kind === "error"), ...l.lines] };
    });
    setBusy(false);
    if (r.exit !== 0 || !onDone) return setDone(r.id); // a failure keeps its details on screen
    onDone(id);
    nudge(update ? `${id} atualizado para ${sha7(sha)}` : `${id} aprovado${always ? " (confiança sempre)" : ""}${deliveredTail(registry, id)}`, "ok");
    router.pop();
  };
  const showCode = async () => {
    try {
      setFiles(update ? ["diff dos commits novos"] : await listCode(dir));
      setStart(undefined);
      setView("code");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  /** Straight into the editor on the selected file, at its first hit. */
  const openFile = () => {
    if (!cur) return void nudge("nenhum arquivo de código");
    setStart({ file: cur.path, line: cur.hits[0]?.line ?? 1 });
    setFiles([cur.path]);
    setView("code");
  };

  useKeys((k) => {
    if (done !== undefined || view === "code") return;
    const trust = !update && view === "full";
    if (k.name === "up" || k.name === "down") {
      if (!trust) return scroll.current?.scrollBy(k.name === "up" ? -1 : 1), true;
      const i = all.indexOf(cur!);
      const to = all[i + (k.name === "up" ? -1 : 1)];
      return to && setSelPath(to.path), true;
    }
    if (trust && matchKey(k, "enter")) return openFile(), true;
    if (k.sequence === "t") return sha ? void approve() : nudge("carregando…"), true;
    if (k.sequence === "T" && !update) return sha ? void approve(true) : nudge("carregando…"), true;
    if (k.sequence === "s") return void showCode(), true;
    if (k.sequence === "p") return setView(view === "perms" ? "full" : "perms"), true;
  });

  if (done !== undefined) return <Result store={store} id={done} onBack={() => router.pop()} />;
  if (view === "code") {
    return (
      <CodeBrowser
        files={files} start={start} onBack={() => setView("full")}
        read={(f) => (update ? codeDiff(dir, update.remoteSha!) : readCode(dir, f))}
        marks={update ? undefined : (f) => all.find((x) => x.path === f)?.hits.map((h) => h.line) ?? []}
      />
    );
  }

  const title = `${g.query} ${update ? "atualização" : "revisão de confiança"} · ${id}${review ? ` ${clean(review.manifest.version)}` : ""}`;
  if (!update && review && view === "full") {
    const wide = !narrow;
    const total = { files: all.length, lines: all.reduce((n, f) => n + f.lines, 0) };
    return (
      <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={title}>
        <Banner r={review} />
        <Strip r={review} />
        <box flexDirection={wide ? "row" : "column"} flexGrow={1} minHeight={0}>
          <Files rows={rows} sel={cur?.path} total={total} grow={wide ? 11 : 3} />
          <Details f={cur} grow={wide ? 9 : 2} inner={wide ? Math.floor(((cols - 2) * 9) / 20) - 4 : cols - 6} />
        </box>
      </box>
    );
  }

  const root = <Row k="" tone="warn">{`${g.warn} este código roda como root neste host. leia o código antes de confiar; o git não prova que é seguro.`}</Row>;
  const body = !update && !review ? (
    <text fg={err ? c.error : c.dim}>{err || "lendo o módulo…"}</text>
  ) : view === "perms" ? (
    <>
      <Perms review={review} diff={update?.permissions} />
      {root}
    </>
  ) : (
    <>
      <Row k="módulo">{`${id}  ${sha7(update!.fromSha)} → ${update!.remoteSha ? sha7(update!.remoteSha) : "?"}`}</Row>
      <Row k="commits novos">{String(update!.behind)}</Row>
      {update!.commits.map((x) => <Row key={x.sha} k="">{`${sha7(x.sha)} ${clean(x.subject)}`}</Row>)}
      <Perms diff={update!.permissions} />
      {update!.permissions.changed ? <Row k="" tone="warn">{`${g.warn} o commit novo muda as permissões: revise antes de aprovar`}</Row> : null}
      {update!.manifestError ? <Row k="manifest" tone="error">{clean(update!.manifestError)}</Row> : null}
      {update!.diverged ? <Row k="histórico" tone="error">divergiu do remoto: não dá fast-forward</Row> : null}
      {update!.dirty ? <Row k="árvore" tone="error">{`${update!.dirty} caminho(s) alterados localmente: limpe antes de atualizar`}</Row> : null}
      {root}
    </>
  );
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={title}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
        <box flexDirection="column" flexShrink={0} paddingX={1}>{body}</box>
      </scrollbox>
    </box>
  );
}
