import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tuiStatePath } from "@pvx/core";

/** Small sibling of tui-state.json, so palette favorites never touch the theme axes. */
export const favoritesPath = () => join(dirname(tuiStatePath()), "palette-favorites.json");

export function loadFavorites(path = favoritesPath()): string[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(raw) ? raw.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function saveFavorites(keys: string[], path = favoritesPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(keys)}\n`, "utf8");
  } catch {}
}
