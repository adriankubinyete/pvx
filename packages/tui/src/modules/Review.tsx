import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { OutLine } from "@pvx/sdk";
import { codeDiff, listCode, readCode, reviewModule, trustModule, updateLines, updateModule, usermodulesDir, type PermDiff, type Registry, type Review, type UpdateCheck } from "@pvx/core";
import { join } from "node:path";
import { matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { Result } from "../menu/Result.tsx";
import { useNudge } from "../nudge.tsx";
import { clean } from "../palette/search.ts";
import { useRouter, useScreenScope } from "../router.tsx";
import { sanitize, type SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";
import { reloadAndReport } from "./actions.ts";
import type { ModulesDeps } from "./deps.ts";

const list = (a?: string[]) => (a?.length ? a.map(clean).join(", ") : "nada");
const sha7 = (s: string) => s.slice(0, 7);
const PERM_KINDS = ["exec", "net", "fs"] as const;

function Row({ k, tone, children }: { k: string; tone?: "warn" | "error"; children: ReactNode }) {
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

/** Module files, then one file as plain read-only text. Update mode shows the diff of the new commits as the single "file". */
function CodeBrowser({ files, read, onBack }: { files: string[]; read: (f: string) => Promise<string> | string; onBack: () => void }) {
  const { c, box, g } = useTheme();
  useScreenScope("files", 2);
  const scroll = useRef<ScrollBoxRenderable>(null);
  const [sel, setSel] = useState(files[0]);
  const [open, setOpen] = useState<{ name: string; lines: string[] } | null>(null);
  const i = Math.max(0, files.indexOf(sel ?? ""));
  useEffect(() => void (sel && !open && scroll.current?.scrollChildIntoView(sel)), [sel, open]);
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
    if (k.name === "escape") return open ? setOpen(null) : onBack(), true;
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
        {open
          ? <text fg={c.text} wrapMode="none">{open.lines.join("\n")}</text>
          : files.length
            ? files.map((f) => <box key={f} id={f} flexShrink={0} paddingX={1} backgroundColor={f === sel ? c.selected : undefined}><text fg={f === sel ? c.accent : c.text}>{`${f === sel ? g.cursor : " "} ${clean(f)}`}</text></box>)
            : <text fg={c.dim}>sem arquivos</text>}
      </scrollbox>
    </box>
  );
}

export interface ReviewProps {
  id: string;
  store: SessionApi;
  registry: Registry;
  deps: ModulesDeps;
  /** Update mode: the fetched check (commits, permission diff). Absent: first-time trust. */
  update?: UpdateCheck;
}

/** The trust review (spec "Tela de revisão"), pushed on the router; the same screen shows an update. Approving runs as a block. */
export function ReviewScreen({ id, store, registry, deps, update }: ReviewProps) {
  const { c, box, g } = useTheme();
  const router = useRouter();
  const nudge = useNudge();
  const dir = join(usermodulesDir(), id);
  const scroll = useRef<ScrollBoxRenderable>(null);
  const [review, setReview] = useState<Review>();
  const [err, setErr] = useState("");
  const [view, setView] = useState<"full" | "perms" | "code">("full");
  const [files, setFiles] = useState<string[]>([]);
  const [done, setDone] = useState<number>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (update) return;
    reviewModule(dir, { hostVersion: deps.load.hostVersion, registry, reserved: deps.reserved }).then(setReview, (e) => setErr((e as Error).message));
  }, []);

  const sha = update ? update.remoteSha : review?.sha;
  const approve = async () => {
    if (!sha || busy) return;
    setBusy(true);
    const line = update ? `modules update ${id} --trust ${sha7(sha)}` : `modules trust ${id} --sha ${sha7(sha)}`;
    const r = await store.act(line, async () => {
      let lines: OutLine[] = [];
      if (update) {
        const u = await updateModule(id, { trust: sha, allowFile: deps.allowFile });
        if (!u.ok) return { exit: 1, lines: updateLines(u) };
        lines = updateLines(u);
      } else {
        const t = await trustModule(id, sha);
        if (!t.ok) return { exit: 1, lines: [{ kind: "error", text: t.error }] };
      }
      const l = await reloadAndReport(registry, deps, id, update ? "atualizado" : "aprovado");
      return { exit: l.exit, lines: [...lines.filter((x) => x.kind === "error"), ...l.lines] };
    });
    setBusy(false);
    setDone(r.id);
  };
  const showCode = async () => {
    try {
      setFiles(update ? ["diff dos commits novos"] : await listCode(dir));
      setView("code");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useKeys((k) => {
    if (done !== undefined || view === "code") return;
    if (k.name === "up" || k.name === "down") return scroll.current?.scrollBy(k.name === "up" ? -1 : 1), true;
    if (k.sequence === "t") return sha ? void approve() : nudge("carregando…"), true;
    if (k.sequence === "s") return void showCode(), true;
    if (k.sequence === "p") return setView(view === "perms" ? "full" : "perms"), true;
  });

  if (done !== undefined) return <Result store={store} id={done} onBack={() => router.pop()} />;
  if (view === "code") return <CodeBrowser files={files} read={(f) => (update ? codeDiff(dir, update.remoteSha!) : readCode(dir, f))} onBack={() => setView("full")} />;

  const root = <Row k="" tone="warn">{`${g.warn} este código roda como root neste host. leia o código antes de confiar; o git não prova que é seguro.`}</Row>;
  const body = !update && !review ? (
    <text fg={err ? c.error : c.dim}>{err || "lendo o módulo…"}</text>
  ) : view === "perms" ? (
    <>
      <Perms review={review} diff={update?.permissions} />
      {root}
    </>
  ) : update ? (
    <>
      <Row k="módulo">{`${id}  ${sha7(update.fromSha)} → ${update.remoteSha ? sha7(update.remoteSha) : "?"}`}</Row>
      <Row k="commits novos">{String(update.behind)}</Row>
      {update.commits.map((x) => <Row key={x.sha} k="">{`${sha7(x.sha)} ${clean(x.subject)}`}</Row>)}
      <Perms diff={update.permissions} />
      {update.permissions.changed ? <Row k="" tone="warn">{`${g.warn} o commit novo muda as permissões: revise antes de aprovar`}</Row> : null}
      {update.manifestError ? <Row k="manifest" tone="error">{clean(update.manifestError)}</Row> : null}
      {update.diverged ? <Row k="histórico" tone="error">divergiu do remoto: não dá fast-forward</Row> : null}
      {update.dirty ? <Row k="árvore" tone="error">{`${update.dirty} caminho(s) alterados localmente: limpe antes de atualizar`}</Row> : null}
      {root}
    </>
  ) : (
    <>
      <Row k="origem">{`${clean(review!.url ?? "(local)")}${review!.ref ? ` (${clean(review!.ref)})` : ""}`}</Row>
      <Row k="commit">{`${review!.sha} fixado: nova confiança se mudar`}</Row>
      <Row k="módulo">{`${clean(review!.id)} ${clean(review!.manifest.version)}`}</Row>
      <Row k="pvx" tone={review!.compat.ok ? undefined : "error"}>{`${review!.compat.ok ? g.ok : g.error} ${clean(review!.compat.text)}`}</Row>
      <Row k="sistema" tone={review!.platform.ok ? undefined : "error"}>{`${review!.platform.ok ? g.ok : g.error} ${clean(review!.platform.text)}`}</Row>
      <Row k="contribui">{`comandos ${list(review!.contributes.commands)}; páginas ${list(review!.contributes.pages)}; widgets ${list(review!.contributes.widgets)}`}</Row>
      {review!.conflicts.length ? review!.conflicts.map((x) => <Row key={x} k="conflito" tone="error">{clean(x)}</Row>) : <Row k="conflitos">nenhum</Row>}
      <Perms review={review} />
      {review!.warnings.map((w, i) => <Row key={i} k={i ? "" : "análise estática"} tone="warn">{clean(w)}</Row>)}
      {root}
    </>
  );
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} ${update ? "atualização" : "revisão de confiança"} · ${id}`}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} focused={false}>
        <box flexDirection="column" flexShrink={0} paddingX={1}>{body}</box>
      </scrollbox>
    </box>
  );
}
