/** @jsxRuntime classic */
/** @jsx h */
// Single owner of PVX_HOME/notes.jsonl. Written like any usermodule: `sdk.fs` is bound to the manifest's `fs` permissions.
import type { ArgSpec, CommandCtx, FieldSpec, ModuleDef, Sdk } from "@pvx/sdk";
import { bytes, clean, fold, freshId, MAX_BYTES, newIds, oneLine, parseEvents, resolveId, type Note, type NoteEvent } from "./notes.ts";

const NOTES = "$PVX_HOME/notes.jsonl";
const SEEN = "$PVX_HOME/seen";
const PEOPLE = "$PVX_HOME/people.json";
/** A widget collect later than this after the previous one means Início was closed meanwhile. */
const GAP_MS = 25_000;

/** What the Notas page reads: open notes, with the display name of each author and whether it is new for the user. */
interface View {
  user: string;
  nick: string;
  notes: (Note & { nick: string; isNew: boolean })[];
}

const tagList = (raw: unknown): string[] =>
  [...new Set(String(raw ?? "").split(/[,\s]+/).map((t) => oneLine(t).replace(/^#+/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "")).filter(Boolean))];
const when = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `hoje ${t}` : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const textArg: ArgSpec = { name: "texto", help: "Texto (ou pela entrada padrão)", kind: "positional", required: true, stdin: true };
const idArg: ArgSpec = { name: "id", help: "Id da nota (ou o começo dele)", kind: "positional", required: true };
const tagArg: ArgSpec = { name: "tag", help: "Etiqueta (pode repetir)", kind: "option", repeat: true };

export default (sdk: Sdk): ModuleDef => {
  const { h, Panel, Text, List, Spacer, Fields, useState, useEffect, useRef, useCommand, useQuery, useKey, useViewport } = sdk.ui;
  const { fs } = sdk;

  const user = () => oneLine(process.env.SUDO_USER || process.env.LOGNAME || "") || "desconhecido";
  const readEvents = async () => ((await fs.exists(NOTES)) ? parseEvents(await fs.read(NOTES)) : []);
  const people = async (): Promise<Record<string, string>> => {
    try {
      return (await fs.exists(PEOPLE)) ? (JSON.parse(await fs.read(PEOPLE)) as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const nickOf = (p: Record<string, string>, u: string) => (typeof p[u] === "string" && oneLine(p[u]!)) || u;
  const seenFile = (u: string) => `${SEEN}/${u.replace(/[^\w.-]/g, "_")}.json`;
  const readSeen = async (u: string): Promise<string | undefined> => {
    try {
      return (await fs.exists(seenFile(u))) ? (JSON.parse(await fs.read(seenFile(u))) as { at?: string }).at : undefined;
    } catch {
      return undefined;
    }
  };
  /** Best effort: whoever cannot write PVX_HOME (not root) just keeps the old marker. */
  const markSeen = async (u: string) => {
    try {
      await fs.write(seenFile(u), JSON.stringify({ at: new Date().toISOString() }));
    } catch {}
  };
  const emit = (e: Omit<NoteEvent, "v" | "at" | "author"> & { author: string }) =>
    fs.append(NOTES, `${JSON.stringify({ v: 1, at: new Date().toISOString(), ...e })}\n`);

  // The marker as it was when Início opened: what is "new" stays new for the whole visit, while the file moves on.
  let base: { at?: string; last: number } | undefined;
  // ponytail: process-wide, so two interleaved users in one process would share it; a pvx process serves one technician.
  async function baselineFor(u: string, touch: boolean) {
    const now = Date.now();
    if (touch && (!base || now - base.last > GAP_MS)) base = { at: await readSeen(u), last: now };
    if (touch && base) base.last = now;
    return base ? base.at : readSeen(u);
  }

  async function view(): Promise<View> {
    const u = user();
    const [events, p, since] = await Promise.all([readEvents(), people(), baselineFor(u, false)]);
    const fresh = newIds(events, u, since);
    const notes = fold(events).filter((n) => !n.resolved).map((n) => ({ ...n, nick: nickOf(p, n.author), isNew: fresh.has(n.id) }));
    return { user: u, nick: nickOf(p, u), notes };
  }

  /** Reads, resolves the id and appends one event. */
  async function change(ctx: CommandCtx, ev: "pin" | "unpin" | "resolve", done: string) {
    const events = await readEvents();
    const notes = fold(events);
    const r = resolveId(notes.map((n) => n.id), String(ctx.args.id ?? ""));
    if ("error" in r) return ctx.out.error(r.error);
    const n = notes.find((x) => x.id === r.id)!;
    if (n.resolved) return ctx.out.error(`nota ${n.id} já foi resolvida`);
    if ((ev === "pin" && n.pinned) || (ev === "unpin" && !n.pinned)) return ctx.out.info(`nota ${n.id} já está ${ev === "pin" ? "fixada" : "solta"}`);
    await emit({ id: n.id, ev, author: user() });
    ctx.out.success(`nota ${n.id} ${done}`);
  }

  async function textOf(ctx: CommandCtx): Promise<string | undefined> {
    const text = clean(String(ctx.args.texto ?? "")).trim();
    if (!text) return void ctx.out.error("texto vazio: passe o texto ou use a entrada padrão");
    if (bytes(text) > MAX_BYTES) return void ctx.out.error(`nota com ${bytes(text)} bytes: o limite é ${MAX_BYTES} (8 KB)`);
    return text;
  }

  const since = (iso: unknown) => {
    const t = String(iso ?? "");
    return readEvents().then((es) => es.filter((e) => e.at > t).map((e) => ({ ...e, author: clean(e.author), ...(e.text === undefined ? {} : { text: clean(e.text) }) })));
  };

  // ---- the Notas page ----
  const FILTERS = ["todas", "fixadas", "novas", "minhas"];
  let wantCompose = false;
  const composeSubs = new Set<() => void>();

  /** A key that exists while the component does (hooks cannot be conditional). */
  function Key({ keys, label, run }: { keys: string; label: string; run: () => void }) {
    useKey(keys, label, run);
    return null;
  }

  function Notas() {
    const [rev, setRev] = useState(0);
    const [filter, setFilter] = useState("todas");
    const [sel, setSel] = useState<string | undefined>(undefined);
    /** The composer: a new note, or the edit of one. */
    const [compose, setCompose] = useState<{ edit?: Note } | null>(null);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const { rows } = useViewport();
    const q = useQuery<View>("notas.view", rev);
    const last = useRef<View | undefined>(undefined);
    if (q.data) last.current = q.data;
    const v = last.current;
    const add = useCommand("nota add");
    const edit = useCommand("nota editar");
    const pin = useCommand("nota fixar");
    const unpin = useCommand("nota desfixar");
    const resolve = useCommand("nota resolver");

    // `n` on Início asks for the composer through the `notas.compose` query.
    useEffect(() => {
      const open = () => wantCompose && ((wantCompose = false), setCompose({}));
      composeSubs.add(open);
      open();
      return () => void composeSubs.delete(open);
    }, []);

    const tags = [...new Set((v?.notes ?? []).flatMap((n) => n.tags))].sort();
    const shown = (v?.notes ?? [])
      .filter((n) => (filter === "fixadas" ? n.pinned : filter === "novas" ? n.isNew : filter === "minhas" ? n.author === v!.user : filter.startsWith("#") ? n.tags.includes(filter.slice(1)) : true))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    const cur = shown.find((n) => n.id === sel) ?? shown[0];
    const count = (f: string) => (v?.notes ?? []).filter((n) => (f === "fixadas" ? n.pinned : f === "novas" ? n.isNew : f === "minhas" ? n.author === v!.user : true)).length;

    const report = (r: { exit: number; lines: { text: string }[] }) => (setMsg({ ok: r.exit === 0, text: r.lines[0]?.text ?? "" }), r.exit === 0 && setRev((n) => n + 1), r.exit === 0);
    const act = (c: { run(o?: { args?: string[] }): Promise<{ exit: number; lines: { text: string }[] }> }, args: string[]) => void c.run({ args }).then(report, (e) => setMsg({ ok: false, text: (e as Error).message }));
    const step = (d: number) => {
      const i = shown.findIndex((n) => n.id === cur?.id);
      const to = shown[Math.max(0, Math.min(shown.length - 1, i + d))];
      if (to) setSel(to.id);
    };

    if (compose && !v) return <Text tone="dim">carregando…</Text>; // the display name is the form's initial value
    if (compose) {
      const editing = compose.edit;
      const fields: FieldSpec[] = [
        { id: "texto", label: "texto", kind: "area", rows: 5 },
        { id: "tags", label: "tags", kind: "line" },
        ...(editing ? [] : [{ id: "apelido", label: "nome exibido", kind: "line" } as FieldSpec, { id: "fixar", label: "fixar na home", kind: "toggle" } as FieldSpec, { id: "login", label: "mostrar no login", kind: "toggle" } as FieldSpec]),
      ];
      const save = (val: Record<string, string | boolean>) => {
        const args = tagList(val.tags).flatMap((t) => ["--tag", t]);
        const text = String(val.texto ?? "");
        if (editing) return void edit.run({ args: [editing.id, ...args], stdin: text }).then((r) => report(r) && setCompose(null), (e) => setMsg({ ok: false, text: (e as Error).message }));
        const apelido = oneLine(String(val.apelido ?? ""));
        if (val.fixar) args.push("--fixar");
        if (val.login) args.push("--login");
        if (apelido && apelido !== v?.nick) args.push("--apelido", apelido);
        void add.run({ args, stdin: text }).then((r) => report(r) && setCompose(null), (e) => setMsg({ ok: false, text: (e as Error).message }));
      };
      return (
        <Panel>
          <Text tone="accent" bold>{editing ? `editar nota ${editing.id}` : "nova nota"}</Text>
          <Text tone="dim">{v ? `autor ${v.nick}${v.nick === v.user ? "" : ` (sudo: ${v.user})`}` : "autor …"}</Text>
          <Fields
            fields={fields}
            initial={editing ? { texto: editing.text, tags: editing.tags.join(" ") } : { apelido: v?.nick ?? "" }}
            onSubmit={save}
            onCancel={() => (setCompose(null), setMsg(null))}
          />
          <Text tone="warn">nunca cole senhas ou tokens: a nota fica legível para todos os técnicos</Text>
          <Text tone="dim">tab muda de campo · ctrl+s salva · esc descarta</Text>
          {msg && !msg.ok ? <Text tone="error">{msg.text}</Text> : null}
        </Panel>
      );
    }

    const allFilters = [...FILTERS, ...tags.map((t) => `#${t}`)];
    const room = Math.max(3, rows - 11);
    const from = Math.max(0, Math.min(shown.findIndex((n) => n.id === cur?.id) - Math.floor(room / 2), shown.length - room));
    const label = (f: string) => (f === filter ? `[${f}${FILTERS.includes(f) && f !== "todas" ? ` ${count(f)}` : ""}]` : f === "todas" ? f : `${f}${FILTERS.includes(f) ? ` ${count(f)}` : ""}`);
    return (
      <Panel>
        <Text tone="dim">{`notas ficam nesta máquina; quem entrar vê todas${v ? ` · ${count("novas")} novas` : ""}`}</Text>
        <Text tone="accent">{allFilters.map(label).join("  ")}</Text>
        <Spacer />
        {shown.length ? (
          <List
            selected={cur?.id}
            items={shown.slice(from, from + room).map((n) => ({
              id: n.id,
              label: `${n.nick} · ${when(n.at)}${n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(" ")}` : ""}${n.pinned ? " · fixada" : ""}`,
              detail: oneLine(n.text),
              mark: n.isNew ? { text: "●", tone: "info" as const } : undefined,
            }))}
          />
        ) : (
          <Text tone="dim">{q.loading && !v ? "carregando…" : "nenhuma nota aqui"}</Text>
        )}
        {msg ? <Text tone={msg.ok ? "ok" : "error"}>{msg.text}</Text> : null}
        <Key keys="↑" label="sobe" run={() => step(-1)} />
        <Key keys="↓" label="desce" run={() => step(1)} />
        <Key keys="n" label="nova" run={() => setCompose({})} />
        <Key keys="f" label="filtro" run={() => setFilter(allFilters[(allFilters.indexOf(filter) + 1) % allFilters.length]!)} />
        {cur ? <Key keys="p" label={cur.pinned ? "solta" : "fixa"} run={() => act(cur.pinned ? unpin : pin, [cur.id])} /> : null}
        {cur ? <Key keys="x" label="resolve" run={() => act(resolve, [cur.id])} /> : null}
        {cur ? <Key keys="e" label="edita" run={() => setCompose({ edit: cur })} /> : null}
      </Panel>
    );
  }

  return {
    commands: {
      add: {
        help: "Cria uma nota para os outros técnicos",
        args: [
          textArg,
          tagArg,
          { name: "fixar", help: "Fixa na home", kind: "flag" },
          { name: "login", help: "Mostra no banner de login", kind: "flag" },
          { name: "ref", help: "Liga a uma entrada do diário ou a uma capacidade", kind: "option" },
          { name: "apelido", help: "Nome exibido do autor (guardado em people.json)", kind: "option" },
        ],
        async run(ctx) {
          const text = await textOf(ctx);
          if (text === undefined) return;
          const [events, u] = [await readEvents(), user()];
          const id = freshId(new Set(events.map((e) => e.id)));
          const ref = oneLine(String(ctx.args.ref ?? ""));
          await emit({ id, ev: "add", author: u, text, tags: tagList(ctx.args.tag), login: ctx.args.login === true, ...(ref ? { ref } : {}) });
          if (ctx.args.fixar === true) await emit({ id, ev: "pin", author: u });
          const nick = oneLine(String(ctx.args.apelido ?? ""));
          if (nick) await fs.write(PEOPLE, JSON.stringify({ ...(await people()), [u]: nick }, null, 2));
          ctx.out.success(`nota ${id} criada`);
        },
      },
      list: {
        help: "Lista as notas abertas",
        readonly: true,
        args: [
          { name: "novas", help: "Só as novas para você", kind: "flag" },
          { name: "fixadas", help: "Só as fixadas", kind: "flag" },
          { name: "minhas", help: "Só as suas", kind: "flag" },
          { name: "tag", help: "Só com esta etiqueta", kind: "option" },
        ],
        async run(ctx) {
          const v = await view();
          const tag = tagList(ctx.args.tag)[0];
          const rowsOut = v.notes
            .filter((n) => (ctx.args.novas ? n.isNew : true) && (ctx.args.fixadas ? n.pinned : true) && (ctx.args.minhas ? n.author === v.user : true) && (tag ? n.tags.includes(tag) : true))
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
          if (!rowsOut.length) ctx.out.info("nenhuma nota");
          for (const n of rowsOut) ctx.out.plain(`${n.isNew ? "●" : " "} ${n.id} ${n.pinned ? "[fixada] " : ""}${n.nick} · ${when(n.at)}${n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(" ")}` : ""}  ${oneLine(n.text)}`);
          await markSeen(v.user);
        },
      },
      fixar: { help: "Fixa uma nota na home", args: [idArg], run: (ctx) => change(ctx, "pin", "fixada") },
      desfixar: { help: "Solta uma nota fixada", args: [idArg], run: (ctx) => change(ctx, "unpin", "solta") },
      resolver: { help: "Marca a nota como resolvida (sai das listas)", args: [idArg], run: (ctx) => change(ctx, "resolve", "resolvida") },
      editar: {
        help: "Troca o texto de uma nota",
        args: [idArg, textArg, tagArg],
        async run(ctx) {
          const notes = fold(await readEvents());
          const r = resolveId(notes.map((n) => n.id), String(ctx.args.id ?? ""));
          if ("error" in r) return ctx.out.error(r.error);
          if (notes.find((n) => n.id === r.id)!.resolved) return ctx.out.error(`nota ${r.id} já foi resolvida`);
          const text = await textOf(ctx);
          if (text === undefined) return;
          const tags = ctx.args.tag === undefined ? undefined : tagList(ctx.args.tag);
          await emit({ id: r.id, ev: "edit", author: user(), text, ...(tags ? { tags } : {}) });
          ctx.out.success(`nota ${r.id} editada`);
        },
      },
    },
    queries: {
      "notas.since": (_, iso) => since(iso),
      "notas.state": async () => fold(await readEvents()),
      "notas.view": () => view(),
      "notas.markSeen": () => markSeen(user()),
      "notas.compose": () => ((wantCompose = true), composeSubs.forEach((f) => f())),
    },
    widgets: {
      home: {
        slot: "home.notes",
        priority: 0,
        refreshMs: 10_000,
        async data() {
          const u = user();
          const [events, p, seenAt] = await Promise.all([readEvents(), people(), baselineFor(u, true)]);
          const open = fold(events).filter((n) => !n.resolved);
          const fresh = [...newIds(events, u, seenAt)].filter((id) => open.some((n) => n.id === id)).length;
          await markSeen(u);
          return [...(fresh ? [`${fresh} ${fresh === 1 ? "nova" : "novas"}`] : []), ...open.filter((n) => n.pinned).map((n) => `${nickOf(p, n.author)}: ${oneLine(n.text)}`)];
        },
      },
    },
    pages: { notas: { title: "notas", render: () => <Notas />, tab: { label: "Notas", order: 3 } } },
  };
};
