// What the module says to the technician.

export const TEXT = {
  empty: "texto vazio: passe o texto ou use a entrada padrão",
  tooLong: (size: number, limit: number) => `nota com ${size} bytes: o limite é ${limit} (8 KB)`,
  signatureTooLong: (limit: number) => `assinatura com mais de ${limit} caracteres`,
  created: (n: number) => `nota ${n} criada`,
  removed: (n: number) => `nota ${n} removida`,
  invalidNumber: (raw: string) => `número de nota inválido: ${raw}`,
  missing: (n: number) => `nota ${n} não existe (ou já foi removida)`,
  none: "nenhuma nota",
} as const;

/** The dialog of `nota remove` in the TUI. */
export const REMOVE_CONFIRM = { title: "remover a nota?", confirmLabel: "remover nota", cancelLabel: "manter" } as const;
