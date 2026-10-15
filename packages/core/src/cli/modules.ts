import { EXIT, type ArgSpec, type OutLine } from "@pvx/sdk";
import { isCatalogUrl, resolveModuleRefInfo } from "../catalog/index.ts";
import { parseArgs } from "../engine/args.ts";
import { commitLabel } from "../modules/embedded.ts";
import { addModule, installedIds, linkModule, listModules, listTrust, removeModule, reviewLines, reviewModule, revokeTrust, setEnabled, trustModule, updateModule, type ModuleRow, type PermDiff, type Result, type UpdateResult } from "../modules/index.ts";
import { join } from "node:path";
import { usermodulesDir } from "../engine/paths.ts";
import type { CoreCommand } from "./core.ts";

export const sha7 = (s?: string) => s?.slice(0, 7);

export function rowLine(r: ModuleRow): OutLine & { module: ModuleRow } {
  const embedded = r.embedded && `embutido (dev) ${commitLabel(r.embedded)}`;
  const extra = [r.official && "◆", embedded, r.ref && r.sha && `${r.ref}@${sha7(r.sha)}`, r.behind && `↓${r.behind}`, r.dirty && `✎${r.dirty}`, r.incompatible && "⚠ sistema", r.always && "∞ sempre", r.error].filter(Boolean).join(" ");
  const kind = r.state === "carregado" || r.state === "atras" ? "success" : "warning";
  const text = r.state === "erro" ? `${r.id} erro: ${r.error}` : `${r.id} ${r.version ?? "?"} ${r.state}${extra ? ` ${extra}` : ""}`;
  return { kind, text, module: r };
}

/** `pvx modules` and `pvx modules list`. */
export const listCommand: CoreCommand["run"] = async ({ io, o }) => {
  const rows = await listModules(io.registry);
  if (!rows.length) o.line({ kind: "info", text: "nenhum módulo instalado" });
  for (const r of rows) o.line(rowLine(r));
  return EXIT.OK;
};

const done = (o: { line(l: OutLine): void }, r: Result) => {
  o.line(r.ok ? { kind: "success", text: r.text } : { kind: "error", text: r.error });
  return r.ok ? EXIT.OK : EXIT.ERROR;
};

const approveHint = (id: string, sha: string) => `para aprovar, rode \`pvx modules trust ${id} --sha ${sha}\``;

const addArgs: ArgSpec[] = [
  { name: "url", help: "usuario/repo (GitHub), URL https/ssh/git@host:caminho, ou id do catálogo", kind: "positional", required: true },
  { name: "ref", help: "Branch, tag ou commit", kind: "option" },
  { name: "trust", help: "Aprova este commit sem revisão em tela", kind: "option" },
  { name: "always", help: "Com --trust: confia sempre neste repositório (commits futuros da mesma origem entram sem revisão)", kind: "flag" },
  { name: "any-os", help: "Instala mesmo se o módulo não declarar este sistema", kind: "flag" },
];
const trustArgs: ArgSpec[] = [
  { name: "id", help: "Módulo", kind: "positional" },
  { name: "sha", help: "Commit a aprovar (deve ser o HEAD)", kind: "option" },
  { name: "always", help: "Com --sha: confia sempre neste repositório (commits futuros da mesma origem entram sem revisão)", kind: "flag" },
  { name: "list", help: "Lista as aprovações", kind: "flag" },
  { name: "revoke", help: "Revoga a aprovação deste módulo", kind: "option" },
];
const updateArgs: ArgSpec[] = [
  { name: "id", help: "Módulo", kind: "positional" },
  { name: "all", help: "Todos os módulos git instalados", kind: "flag" },
  { name: "trust", help: "Aprova e aplica o commit remoto (sha buscado)", kind: "option" },
];
const permLines = (d: PermDiff): OutLine[] =>
  (["added", "removed"] as const).flatMap((w) =>
    Object.entries(d[w]).map(([k, v]): OutLine => ({ kind: w === "added" ? "warning" : "info", text: `permissões ${w === "added" ? "ADICIONADAS" : "removidas"} (${k}): ${v.join(", ")}` })),
  );

export function updateLines(r: UpdateResult): OutLine[] {
  if (!r.ok) {
    const f = r.check;
    return [...(f?.behind ? [...f.commits.map((x): OutLine => ({ kind: "plain", text: `  ${sha7(x.sha)} ${x.subject}` })), ...permLines(f.permissions)] : []), { kind: "error", text: `${r.id}: ${r.error}` }];
  }
  const c = r.check;
  if (r.status === "ja-atualizado") return [{ kind: "success", text: `${r.id}: já está atualizado` }];
  const out: OutLine[] = [{ kind: "info", text: `${r.id}: ${c.behind} commit(s) novo(s)` }];
  for (const x of c.commits) out.push({ kind: "plain", text: `  ${sha7(x.sha)} ${x.subject}` });
  out.push(...permLines(c.permissions));
  if (r.status === "pendente") {
    out.push({ kind: "warning", text: `${r.id} segue no commit aprovado ${sha7(c.fromSha)} (atrás ${c.behind}); para aplicar, rode \`pvx modules update ${r.id} --trust ${sha7(c.remoteSha)}\`` });
  } else if (r.auto) out.push({ kind: "success", text: `${r.id} atualizado automaticamente em ${sha7(r.sha)} (confiança sempre)` });
  else out.push({ kind: "success", text: `${r.id} atualizado e aprovado em ${sha7(r.sha)}` });
  return out;
}

const idArgs: ArgSpec[] = [{ name: "id", help: "Módulo", kind: "positional", required: true }];

export const MODULES_COMMANDS: CoreCommand[] = [
  { key: "modules list", help: "Lista módulos, versão e estado (igual a `modules`)", run: listCommand },
  {
    key: "modules add",
    help: "Clona um módulo git, mostra a revisão e só aprova com --trust (--always: confia sempre)",
    root: true,
    args: addArgs,
    async run({ io, o, rest }) {
      const p = await parseArgs(addArgs, rest, { env: io.env });
      if (!p.ok) return usage(o, p.message);
      if (p.args.always && !p.args.trust) return usage(o, "--always exige --trust <sha>");
      let url: string;
      let catalog: boolean;
      try {
        const lookup = { allowFile: io.allowFile };
        if (io.allowFile && String(p.args.url).startsWith("file://")) (url = String(p.args.url)), (catalog = await isCatalogUrl(url, lookup));
        else ({ url, catalog } = await resolveModuleRefInfo(String(p.args.url), lookup));
      } catch (e) {
        return usage(o, (e as Error).message);
      }
      if (url !== p.args.url) o.line({ kind: "info", text: `repositório: ${url}` });
      const r = await addModule(url, {
        hostVersion: io.version,
        ref: p.args.ref as string | undefined,
        trust: p.args.trust as string | undefined,
        always: Boolean(p.args.always),
        catalog,
        allowFile: io.allowFile,
        registry: io.registry,
        reserved: io.reservedWords,
        onIncompatible: async () => Boolean(p.args["any-os"]),
      });
      if (!r.ok) {
        if (r.review) reviewLines(r.review, "").slice(0, -1).forEach((l) => o.line(l));
        const code = done(o, r);
        if (r.incompatible) o.line({ kind: "info", text: "para instalar mesmo assim, rode de novo com --any-os" });
        return code;
      }
      if (r.status === "ja-instalado") return o.line({ kind: "info", text: `${r.id}: já instalado (${r.state})` }), EXIT.OK;
      if (catalog) {
        reviewLines(r.review!, "commit aprovado; o módulo carrega na próxima execução").forEach((l) => o.line(l));
        o.line({ kind: "success", text: `${r.id} instalado do catálogo: confiança sempre` });
        return EXIT.OK;
      }
      reviewLines(r.review!, r.state === "aguardando-confianca" ? approveHint(r.id, r.sha!) : "commit aprovado; o módulo carrega na próxima execução").forEach((l) => o.line(l));
      o.line({ kind: r.state === "aguardando-confianca" ? "warning" : "success", text: `${r.id} instalado: ${r.state}` });
      return EXIT.OK;
    },
  },
  {
    key: "modules remove",
    help: "Remove o módulo e a aprovação; o estado fica, salvo com --purge",
    root: true,
    destructive: true,
    args: [...idArgs, { name: "purge", help: "Apaga também o estado do módulo", kind: "flag" }],
    async run({ io, o, rest, yes }) {
      const p = await parseArgs(this.args, rest, { env: io.env });
      if (!p.ok) return usage(o, p.message);
      if (!yes) {
        if (!(io.isTTY && io.ask)) return usage(o, "fora de um terminal, `modules remove` exige --yes");
        const a = (await io.ask(`remover \`${p.args.id}\`? [s/N] `)).trim().toLowerCase();
        if (a !== "s" && a !== "sim") return o.line({ kind: "error", text: "cancelado" }), EXIT.ERROR;
      }
      return done(o, removeModule(String(p.args.id), { purge: Boolean(p.args.purge) }));
    },
  },
  {
    key: "modules update",
    help: "Busca commits novos e mostra mudança de permissões; só aplica com --trust <sha> (ou sozinho, se o módulo tem confiança sempre)",
    root: true,
    args: updateArgs,
    async run({ io, o, rest }) {
      const p = await parseArgs(updateArgs, rest, { env: io.env });
      if (!p.ok) return usage(o, p.message);
      if (!p.args.id === !p.args.all) return usage(o, "informe um módulo ou --all");
      if (p.args.all && p.args.trust) return usage(o, "--trust vale para um módulo só: o sha é de um commit");
      const ids = p.args.all ? installedIds() : [String(p.args.id)];
      if (!ids.length) return o.line({ kind: "info", text: "nenhum módulo instalado" }), EXIT.OK;
      let exit: number = EXIT.OK;
      for (const id of ids) {
        const r = await updateModule(id, { trust: p.args.trust as string | undefined, allowFile: io.allowFile });
        updateLines(r).forEach((l) => o.line(l));
        if (!r.ok) exit = EXIT.ERROR;
      }
      return exit;
    },
  },
  {
    key: "modules link",
    help: "Liga uma pasta de trabalho como módulo dev (recarrega ao salvar na TUI; sem confiança por commit)",
    root: true,
    args: [{ name: "path", help: "Pasta do módulo", kind: "positional", required: true }],
    async run({ io, o, rest }) {
      const p = await parseArgs(this.args, rest, { env: io.env });
      if (!p.ok) return usage(o, p.message);
      const r = linkModule(String(p.args.path), { registry: io.registry, reserved: io.reservedWords });
      if (r.ok && !r.text.endsWith("já linkado")) o.line({ kind: "warning", text: "módulo dev: não há confiança por commit; este código roda como root" });
      return done(o, r);
    },
  },
  { key: "modules enable", help: "Liga um módulo desativado", root: true, args: idArgs, run: (c) => toggle(c, true) },
  { key: "modules disable", help: "Desliga um módulo sem removê-lo", root: true, args: idArgs, run: (c) => toggle(c, false) },
  {
    key: "modules trust",
    help: "Aprova o commit de um módulo (--always: confia sempre), lista (--list) ou revoga (--revoke <id>)",
    root: true,
    args: trustArgs,
    async run({ io, o, rest }) {
      const p = await parseArgs(trustArgs, rest, { env: io.env });
      if (!p.ok) return usage(o, p.message);
      if (p.args.list) {
        const all = Object.entries(listTrust());
        if (!all.length) o.line({ kind: "info", text: "nenhuma aprovação" });
        for (const [id, t] of all) o.line({ kind: "plain", text: `${id} ${sha7(t.sha)} ${t.approvedBy} ${t.at} ${t.url}${t.always ? " sempre" : ""}` });
        return EXIT.OK;
      }
      if (p.args.revoke) return done(o, revokeTrust(String(p.args.revoke)));
      if (p.args.always && !p.args.sha) return usage(o, "--always exige --sha <sha>");
      if (!p.args.id) return usage(o, "informe o módulo: `modules trust <id> --sha <sha>`");
      const id = String(p.args.id);
      if (p.args.sha) return done(o, await trustModule(id, String(p.args.sha), { always: Boolean(p.args.always) }));
      try {
        const r = await reviewModule(join(usermodulesDir(), id), { hostVersion: io.version, registry: io.registry, reserved: io.reservedWords });
        reviewLines(r, approveHint(id, r.sha)).forEach((l) => o.line(l));
        return EXIT.OK;
      } catch (e) {
        return done(o, { ok: false, error: (e as Error).message });
      }
    },
  },
];

async function toggle({ io, o, rest }: Parameters<CoreCommand["run"]>[0], on: boolean) {
  const p = await parseArgs(idArgs, rest, { env: io.env });
  return p.ok ? done(o, setEnabled(String(p.args.id), on)) : usage(o, p.message);
}

function usage(o: { line(l: OutLine): void }, text: string) {
  o.line({ kind: "error", text });
  return EXIT.USAGE;
}
