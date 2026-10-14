import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { EXIT, type ArgSpec } from "@pvx/sdk";
import { parseArgs } from "../engine/args.ts";
import { profiledDir, pvxHome } from "../engine/paths.ts";
import type { CoreCommand } from "./core.ts";
import type { Output } from "./run.ts";

const REPO = "adriankubinyete/pvx";
const fail = (o: Output, text: string, exit: number = EXIT.ERROR) => (o.line({ kind: "error", text }), exit);
const isYes = (a: string) => ["s", "sim", "y", "yes"].includes(a.trim().toLowerCase());

const semver = (v: string) => v.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
export const compareSemver = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
};

const sha256 = (buf: Uint8Array) => new Bun.CryptoHasher("sha256").update(buf).digest("hex");
const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "pvx-self-update" } });

/** The command names, so the TUI shows the same text the CLI answers to. */
export const SELF_UPDATE_COMMAND = "self-update";
export const UNINSTALL_COMMAND = "uninstall";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}
export type LatestRelease = { ok: true; release: Release; version: string } | { ok: false; message: string };

/** Asks GitHub for the latest release. Never throws: a failure comes back as the message to show. */
export async function fetchLatestRelease(env: Record<string, string | undefined>): Promise<LatestRelease> {
  try {
    const response = await get(`${env.PVX_API_BASE ?? "https://api.github.com"}/repos/${REPO}/releases/latest`);
    if (!response.ok) return { ok: false, message: `consulta da última release falhou: HTTP ${response.status}` };
    const release = (await response.json()) as Release;
    return { ok: true, release, version: release.tag_name.replace(/^v/, "") };
  } catch (error) {
    return { ok: false, message: `consulta da última release falhou: ${(error as Error).message}` };
  }
}

/** The installed binary, through symlinks. Overridable for tests; from source (`bun index.ts`) there is none. */
export function selfPath(env: Record<string, string | undefined>): string | null {
  if (env.PVX_SELF_PATH) return realpathSync(env.PVX_SELF_PATH);
  return /^bun(\.exe)?$/.test(basename(process.execPath)) ? null : realpathSync(process.execPath);
}

const platformAsset = () => `pvx-${process.platform}-${process.arch === "x64" ? "amd64" : process.arch}.tar.gz`;

export const SELF_COMMANDS: CoreCommand[] = [
  {
    key: SELF_UPDATE_COMMAND,
    help: "Atualiza o pvx para a última release (não atualiza módulos: use `modules update`)",
    root: true,
    noAudit: true,
    async run({ io, o, yes }) {
      const cur = io.version.split(" ")[0]!;
      const dev = io.version.includes(" (");
      const self = selfPath(io.env);
      if (!self) return fail(o, "self-update só funciona no binário instalado");

      const found = await fetchLatestRelease(io.env);
      if (!found.ok) return fail(o, found.message);
      const rel = found.release;
      const latest = found.version;
      if (!dev && compareSemver(latest, cur) <= 0) {
        o.line({ kind: "success", text: `já está na versão mais recente (${cur})` });
        return EXIT.OK;
      }
      if (dev) {
        // A dev build is not a release: replacing it is a choice, never a side effect.
        if (!yes && !(io.isTTY && io.ask)) return fail(o, "esta é uma build de desenvolvimento; fora de um terminal, `self-update` exige --yes", EXIT.USAGE);
        if (!yes && !isYes(await io.ask!(`build de desenvolvimento (${io.version}); trocar pela release ${latest}? [s/N] `))) return fail(o, "cancelado");
      }

      const name = platformAsset();
      const asset = rel.assets.find((a) => a.name === name);
      const sums = rel.assets.find((a) => a.name === "checksums-sha256.txt");
      if (!asset || !sums) return fail(o, `a release ${rel.tag_name} não tem ${name} e checksums-sha256.txt`);

      // Temp dir beside the binary: the final rename stays on one filesystem, so it is atomic.
      let tmp: string;
      try {
        tmp = mkdtempSync(join(dirname(self), ".pvx-update-"));
      } catch (e) {
        return fail(o, `sem permissão para gravar em ${dirname(self)}: ${(e as Error).message}`);
      }
      try {
        const [tgz, txt] = await Promise.all(
          [asset, sums].map(async (a) => {
            const r = await get(a.browser_download_url);
            if (!r.ok) throw new Error(`download de ${a.name} falhou: HTTP ${r.status}`);
            return new Uint8Array(await r.arrayBuffer());
          }),
        );
        const want = new TextDecoder().decode(txt!).split("\n").map((l) => l.trim().split(/\s+/)).find((p) => p[1]?.replace(/^\*/, "") === name)?.[0];
        if (!want) throw new Error(`${name} não consta em checksums-sha256.txt`);
        if (sha256(tgz!) !== want) throw new Error(`checksum de ${name} não confere; o instalado não foi alterado`);
        await Bun.write(join(tmp, name), tgz!);
        const tar = Bun.spawnSync(["tar", "-xzf", name, "pvx"], { cwd: tmp });
        if (tar.exitCode !== 0) throw new Error("tarball inválido; o instalado não foi alterado");
        chmodSync(join(tmp, "pvx"), 0o755);
        renameSync(join(tmp, "pvx"), self);
      } catch (e) {
        return fail(o, (e as Error).message);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
      o.line({ kind: "success", text: `pvx atualizado: ${cur} -> ${latest}` });
      o.line({ kind: "warning", text: "processos em execução continuam na versão antiga até reiniciarem" });
      return EXIT.OK;
    },
  },
  {
    key: UNINSTALL_COMMAND,
    help: "Remove o pvx do sistema (--purge também remove o PVX_HOME)",
    root: true,
    noAudit: true, // after --purge the audit file would recreate PVX_HOME
    args: [
      { name: "purge", help: "Remove também o PVX_HOME (notas e módulos de usuário só com confirmação)", kind: "flag" },
      { name: "purge-notes-and-modules", help: "Com --purge, confirma de antemão a remoção de notes.jsonl e usermodules/", kind: "flag" },
    ] satisfies ArgSpec[],
    async run({ io, o, rest }) {
      const p = await parseArgs(this.args!, rest, { env: io.env });
      if (!p.ok) return fail(o, p.message, EXIT.USAGE);
      const rm = (path: string) => {
        try {
          lstatSync(path); // also true for a dangling symlink
        } catch {
          return;
        }
        rmSync(path, { recursive: true, force: true });
        o.line({ kind: "success", text: `removido: ${path}` });
      };
      const e = io.env;
      rm(e.PVX_LIB_DIR ?? "/usr/local/lib/pvx");
      rm(join(e.PVX_BIN_DIR ?? "/usr/local/bin", "pvx"));
      rm(join(e.PVX_USRBIN_DIR ?? "/usr/bin", "pvx"));
      rm(join(profiledDir(), "pvx-banner.sh"));
      if (!p.args.purge) return EXIT.OK;

      // Notes and user modules are the operator's data: only an explicit answer deletes them. `--yes` is
      // not one (it is global and habitual); non-interactive runs need `--purge-notes-and-modules`.
      let all = Boolean(p.args["purge-notes-and-modules"]);
      if (!all && io.isTTY && io.ask) all = isYes(await io.ask("apagar também notes.jsonl e usermodules/? [s/N] "));
      const home = pvxHome();
      if (all) rm(home);
      else if (existsSync(home)) {
        const keep = ["notes.jsonl", "usermodules"];
        for (const n of readdirSync(home)) if (!keep.includes(n)) rm(join(home, n));
        const kept = keep.filter((n) => existsSync(join(home, n)));
        if (kept.length) o.line({ kind: "info", text: `mantidos em ${home}: ${kept.join(", ")}` });
        else rm(home);
      }
      return EXIT.OK;
    },
  },
];
