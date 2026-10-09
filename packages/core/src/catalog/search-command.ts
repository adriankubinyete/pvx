import { EXIT, type ArgSpec } from "@pvx/sdk";
import { isInstalled, loadCatalog, searchCatalog } from "./index.ts";
import type { Entry } from "../cli/help.ts";
import type { CliIO, Output } from "../cli/run.ts";

const args: ArgSpec[] = [{ name: "termo", help: "Filtra por id ou descrição", kind: "positional" }];

/** `pvx modules search [termo]`: read-only, no root. Register in CORE with one line: `catalogSearchCommand`. */
export const catalogSearchCommand: Entry & { run(c: { io: CliIO; o: Output; rest: string[]; json: boolean }): Promise<number> } = {
  key: "modules search",
  help: "Procura módulos no catálogo",
  args,
  async run({ o, rest, json }) {
    const cat = await loadCatalog();
    const found = searchCatalog(cat, rest.join(" "));
    const rows = found.map((m) => ({ ...m, installed: isInstalled(m.id) }));
    // --json: the Output only carries lines, so the payload is ONE plain line holding the JSON object.
    if (json) {
      o.line({ kind: "plain", text: JSON.stringify({ source: cat.source, fetchedAt: cat.fetchedAt ?? null, modules: rows }) });
      return EXIT.OK;
    }
    if (!rows.length) o.line({ kind: "info", text: "nenhum módulo encontrado" });
    for (const r of rows) o.line({ kind: "plain", text: `${r.installed ? "✓" : " "} ${r.id}${r.versao ? ` ${r.versao}` : ""}  ${r.descricao}` });
    o.line({ kind: "info", text: `fonte: ${cat.source}${cat.fetchedAt ? ` (${new Date(cat.fetchedAt).toLocaleString("pt-BR")})` : ""}` });
    return EXIT.OK;
  },
};
