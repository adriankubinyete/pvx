import { describe, expect, test } from "bun:test";
import type { CommandCtx, ExecResult } from "@pvx/sdk";
import { createShell, cronKit, crontabKit, validateKit } from "../../src/index.ts";

describe("sdk.cron", () => {
  test("validate accepts five valid fields, with lists, ranges and steps", () => {
    for (const expression of ["30 3 * * *", " 0  2 * * 0 ", "*/15 * * * *", "0 9-17 * * 1-5", "0,30 8 1,15 * *", "0 0 * * 7"]) {
      expect(cronKit.validate(expression)).toBeUndefined();
    }
  });

  test("validate names the field and the range, and refuses what must never reach a crontab", () => {
    expect(cronKit.validate("* * * *")).toContain("5 campos");
    expect(cronKit.validate("60 3 * * *")).toBe("agendamento inválido, minuto: use de 0 a 59");
    expect(cronKit.validate("0 24 * * *")).toContain("hora: use de 0 a 23");
    expect(cronKit.validate("0 0 0 * *")).toContain("dia do mês");
    expect(cronKit.validate("5-1 0 * * *")).toContain("o início passa do fim");
    expect(cronKit.validate("5/2 0 * * *")).toContain("o passo vale só depois");
    expect(cronKit.validate("*/0 0 * * *")).toContain("o passo precisa ser 1 ou mais");
    for (const bad of ["@reboot", "0 0 * * mon", "0 0 * * * %", '0 "0" * * *', "0 0 * * *;rm"]) expect(cronKit.validate(bad)).toBeDefined();
  });

  test("describe gives a short pt-BR text and falls back to the normalized expression", () => {
    expect(cronKit.describe("30 3 * * *")).toBe("diário 03:30");
    expect(cronKit.describe("0 2 * * 0")).toBe("semanal dom 02:00");
    expect(cronKit.describe("0 2 * * 7")).toBe("semanal dom 02:00");
    expect(cronKit.describe("15 4 5 * *")).toBe("mensal dia 5 04:15");
    expect(cronKit.describe("*/15 * * * *")).toBe("a cada 15 min");
    expect(cronKit.describe("0 * * * *")).toBe("de hora em hora");
    expect(cronKit.describe("0 */2 * * *")).toBe("a cada 2 h");
    expect(cronKit.describe("0  9-17   * * 1-5")).toBe("0 9-17 * * 1-5");
    expect(cronKit.normalize("  1   2 * *  * ")).toBe("1 2 * * *");
  });
});

describe("sdk.validate", () => {
  test("firstProblem returns the first text, or undefined when every check passes", () => {
    expect(validateKit.firstProblem(undefined, "segundo", "terceiro")).toBe("segundo");
    expect(validateKit.firstProblem(undefined, undefined)).toBeUndefined();
    expect(validateKit.firstProblem()).toBeUndefined();
  });
});

// ---- sdk.crontab over a fake `crontab` ----

interface FakeCrontab {
  text: string | undefined;
  readError?: string;
  writeFails?: boolean;
  writes: string[];
  readEnv: (Record<string, string> | undefined)[];
}

const fakeCrontab = (text?: string): FakeCrontab => ({ text, writes: [], readEnv: [] });

/** `crontab -l` prints the text or says "no crontab for root" (exit 1); `crontab -` replaces it. */
function shellOver(state: FakeCrontab) {
  const exec: CommandCtx["exec"] = async (_cmd, args = [], opts) => {
    if (args[0] === "-l") {
      state.readEnv.push(opts?.env);
      if (state.readError !== undefined) return { code: 1, stdout: "", stderr: state.readError };
      if (state.text === undefined) return { code: 1, stdout: "", stderr: "no crontab for root" };
      return { code: 0, stdout: state.text, stderr: "" } satisfies ExecResult;
    }
    if (state.writeFails) return { code: 1, stdout: "", stderr: "crontab: installing new crontab failed" };
    state.writes.push(opts?.stdin ?? "");
    state.text = opts?.stdin ?? "";
    return { code: 0, stdout: "", stderr: "" };
  };
  return createShell(exec);
}

const OTHER = ["MAILTO=ops@example.com", "0 5 * * * /usr/local/bin/outro.sh", "# a comment"];
const block = crontabKit.block("meumodulo");
const BEGIN = "# BEGIN pvx meumodulo (gerenciado pelo pvx: não edite à mão)";
const END = "# END pvx meumodulo";
const ENTRY = "30 3 * * * /usr/bin/pvx meumodulo run a >/dev/null 2>&1";

describe("sdk.crontab block", () => {
  test("the markers come from the module id", () => {
    expect(block.begin).toBe(BEGIN);
    expect(block.end).toBe(END);
    expect(crontabKit.block("outro").begin).not.toBe(BEGIN);
  });

  test("merge appends, replaces in place and drops the block, keeping every other line", () => {
    expect(block.merge(OTHER, [ENTRY])).toEqual({ lines: [...OTHER, BEGIN, ENTRY, END] });
    expect(block.merge([OTHER[0]!, BEGIN, "old", END, OTHER[1]!], [ENTRY, "x"])).toEqual({ lines: [OTHER[0]!, BEGIN, ENTRY, "x", END, OTHER[1]!] });
    expect(block.merge([...OTHER, BEGIN, "old", END], [])).toEqual({ lines: OTHER });
    expect(block.merge(OTHER, [])).toEqual({ lines: OTHER });
  });

  test("a half, duplicated or reversed block stops the merge and the read of its entries", () => {
    for (const lines of [[BEGIN, "x"], ["x", END], [BEGIN, END, BEGIN, END], [END, BEGIN]]) {
      expect(block.merge(lines, [ENTRY])).toHaveProperty("error");
      expect(block.entries(lines)).toHaveProperty("error");
    }
    expect(block.entries([...OTHER, BEGIN, "a", "b", END])).toEqual(["a", "b"]);
    expect(block.entries(OTHER)).toEqual([]);
  });

  test("read asks for the C locale and treats only \"no crontab for\" as empty", async () => {
    const empty = fakeCrontab(undefined);
    expect(await block.read(shellOver(empty))).toEqual([]);
    expect(empty.readEnv[0]).toEqual({ LC_ALL: "C" });
    expect(await block.read(shellOver(fakeCrontab("a\nb\n")))).toEqual(["a", "b"]);
    const broken = fakeCrontab("x");
    broken.readError = "crontab: cannot read /var/spool/cron: permission denied";
    await expect(block.read(shellOver(broken))).rejects.toThrow("não consegui ler o crontab");
  });

  test("sync keeps the other lines, checks the exit and returns the crontab as it was", async () => {
    const state = fakeCrontab(`${OTHER.join("\n")}\n`);
    const before = await block.sync(shellOver(state), [ENTRY]);
    expect(before).toEqual(OTHER);
    expect(state.text).toBe(`${[...OTHER, BEGIN, ENTRY, END].join("\n")}\n`);
    state.writeFails = true;
    await expect(block.sync(shellOver(state), [])).rejects.toThrow("não consegui gravar o crontab");
  });

  test("a failed read or a damaged block writes nothing: a hiccup never becomes an empty crontab", async () => {
    const unreadable = fakeCrontab("x");
    unreadable.readError = "crontab: boom";
    await expect(block.sync(shellOver(unreadable), [ENTRY])).rejects.toThrow("nada foi alterado");
    expect(unreadable.writes).toEqual([]);
    const damaged = fakeCrontab(`${BEGIN}\nx\n`);
    await expect(block.sync(shellOver(damaged), [ENTRY])).rejects.toThrow("incompleto ou duplicado");
    expect(damaged.writes).toEqual([]);
  });

  test("update rolls the crontab back when the commit fails, and rethrows the commit's error", async () => {
    const state = fakeCrontab(`${OTHER.join("\n")}\n`);
    const original = state.text;
    const failure = new Error("sem espaço para salvar");
    await expect(block.update(shellOver(state), [ENTRY], () => { throw failure; })).rejects.toBe(failure);
    expect(state.text).toBe(original);
    expect(state.writes).toHaveLength(2); // the new block, then the way back
    await block.update(shellOver(state), [ENTRY], () => {});
    expect(state.text).toContain(ENTRY);
  });

  test("when the rollback fails too, the error says the crontab may hold the new block", async () => {
    const state = fakeCrontab(`${OTHER.join("\n")}\n`);
    const shell = shellOver(state);
    const failing = block.update(shell, [ENTRY], () => {
      state.writeFails = true;
      throw new Error("falhou");
    });
    await expect(failing).rejects.toThrow("pode ainda ter o bloco novo");
    try {
      await failing;
    } catch (error) {
      expect(crontabKit.isError(error)).toBe(true);
    }
  });

  test("isError tells the kit's error from any other", async () => {
    const unreadable = fakeCrontab("x");
    unreadable.readError = "boom";
    const error = await block.read(shellOver(unreadable)).catch((caught: unknown) => caught);
    expect(crontabKit.isError(error)).toBe(true);
    expect(crontabKit.isError(new Error("x"))).toBe(false);
  });
});
