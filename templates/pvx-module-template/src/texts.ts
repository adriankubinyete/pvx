// Every string the user reads, and the commands a fix points to. Pages and commands never write their own.
export const FIX = {
  greet: "exemplo saudar",
} as const;

export const TEXT = {
  greeted: (name: string) => `olá, ${name}`,
  nobodyGreeted: "ninguém foi saudado ainda",
  greetingDone: "saudação feita",
  pageTitle: "exemplo",
  historyTitle: "[1] saudados",
  historyEmpty: "ninguém foi saudado",
  greetButton: "saudar o mundo",
  greeting: "saudando…",
} as const;
