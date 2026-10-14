import type { Strategy, StrategyKit } from "@pvx/sdk";

const AUTO = "auto";

async function firstAvailable<Item extends Strategy>(strategies: Item[]): Promise<Item | undefined> {
  for (const strategy of strategies) {
    if (await strategy.available()) return strategy;
  }
  return undefined;
}

/** `sdk.strategy`: picks the backend a module drives. */
export const strategyKit: StrategyKit = {
  async pick(strategies, { setting = AUTO, none }) {
    if (setting !== AUTO) {
      const chosen = strategies.find((strategy) => strategy.id === setting);
      if (!chosen) return { error: `desconhecido: ${setting} (use ${[AUTO, ...strategies.map((strategy) => strategy.id)].join(", ")})` };
      return { strategy: chosen, auto: false };
    }
    const found = await firstAvailable(strategies);
    return found ? { strategy: found, auto: true } : { error: none };
  },
};
