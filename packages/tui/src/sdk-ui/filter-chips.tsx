import { FilterChip } from "./kit.tsx";

export interface FilterChipItem {
  id: string;
  label: string;
}

/**
 * A row of filter chips (UI.md, "Chips de filtro"): the chosen one is filled, the others sit on the `panel` fill, and one click chooses.
 * `cursor` is the chip the keyboard is on while the row has the focus (it is underlined); a page that changes the filter with `←→` at once
 * passes its chosen chip as the cursor. The page owns the keys: `←→` move, `enter` chooses. The chips wrap when the row is too narrow.
 */
export function FilterChips({ chips, selected, cursor, onSelect }: { chips: readonly FilterChipItem[]; selected: string; cursor?: string; onSelect: (id: string) => void }) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={1}>
      {chips.map((chip) => (
        <FilterChip key={chip.id} label={chip.label} on={chip.id === selected} cursor={chip.id === cursor} onPress={() => onSelect(chip.id)} />
      ))}
    </box>
  );
}
