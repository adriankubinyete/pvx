import { useMemo, type ReactNode } from "react";
import { CardGrid as FrameworkCardGrid, type CardData } from "../sdk-ui/card.tsx";
import { useTheme } from "../theme-context.tsx";
import type { Tokens } from "../theme.ts";
import type { Card } from "./cards.ts";
import type { Origin } from "./tree.ts";

/** The badge before a module's name: official, in development (embedded or linked) or third party. */
function badgeOf(origin: Origin | undefined, c: Tokens, g: { official: string; thirdParty: string }): NonNullable<CardData["badge"]> {
  if (origin === "official") return { text: g.official, color: c.accent };
  if (origin === "dev" || origin === "embedded") return { text: "dev", color: c.warn };
  return { text: g.thirdParty, color: c.thirdParty };
}

/** A card of the Módulos tab as the framework card draws it. A catalog card is a quiet suggestion: its version stands where the state does. */
function dataOf(card: Card, c: Tokens, g: { official: string; thirdParty: string }): CardData {
  const common = { id: card.id, name: card.name, chips: card.chips };
  if (card.kind === "add" || card.kind === "open") return { ...common, action: { key: card.key ?? "", sub: card.sub } };
  const badge = badgeOf(card.origin, c, g);
  const line2 = card.line2;
  if (card.kind === "catalog") return { ...common, badge, quiet: true, line2, state: card.version ? { text: card.version, tone: "dim" } : undefined };
  const lead = card.official ? "oficial" : undefined;
  return { ...common, badge, line2, lead, footnote: card.version, state: card.state };
}

export interface CardGridProps {
  cards: Card[];
  /** Id of the selected card (selection by id, never by index); the first one when unknown. */
  sel?: string;
  onSel: (id: string) => void;
  onActivate: (card: Card) => void;
  /** Up on the first row: focus goes to the tab bar. */
  onTop?: () => void;
  focused: boolean;
  /** Shown instead of the cards when there are none (text, or a node such as `Loading`). */
  empty?: ReactNode;
}

/** The module cards of the Módulos tab, drawn by the framework grid (UI.md, "Cards"). */
export function CardGrid({ cards, sel, onSel, onActivate, onTop, focused, empty }: CardGridProps) {
  const { c, g } = useTheme();
  const data = useMemo(() => cards.map((card) => dataOf(card, c, g)), [cards, c, g]);
  const activate = (id: string) => onActivate(cards.find((card) => card.id === id)!);
  return <FrameworkCardGrid cards={data} sel={sel} onSel={onSel} onActivate={activate} onTop={onTop} focused={focused} empty={empty} />;
}
