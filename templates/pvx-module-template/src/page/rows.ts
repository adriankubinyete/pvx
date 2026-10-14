// Pure helpers of the page: the data to rows, no UI and no store.
import type { ListItem } from "@pvx/sdk";

/** One row per greeted name. The id is the name itself: selection is by id, never by row index. */
export const historyRows = (names: string[]): ListItem[] => names.map((name) => ({ id: name, label: name }));

export const rowIds = (rows: ListItem[]): string[] => rows.map((row) => row.id);
