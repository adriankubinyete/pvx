import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTuiState, loadTuiState, saveTuiState } from "../src/tui-state.ts";

const withFile = (content: string, fn: (path: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "pvx-tuistate-"));
  try {
    const path = join(dir, "tui-state.json");
    writeFileSync(path, content);
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("hiddenTabs and hiddenWidgets default to empty lists", () => {
  expect(defaultTuiState()).toMatchObject({ hiddenTabs: [], hiddenWidgets: [] });
  withFile("{}", (p) => expect(loadTuiState(p)).toMatchObject({ hiddenTabs: [], hiddenWidgets: [] }));
});

test("hidden lists round-trip through save and load", () => {
  withFile("{}", (p) => {
    saveTuiState({ ...defaultTuiState(), hiddenTabs: ["firewall"], hiddenWidgets: ["firewall", "motd"] }, p);
    expect(loadTuiState(p)).toMatchObject({ hiddenTabs: ["firewall"], hiddenWidgets: ["firewall", "motd"] });
  });
});

test("hidden lists are validated as string arrays: anything else is dropped", () => {
  withFile(JSON.stringify({ hiddenTabs: "firewall", hiddenWidgets: ["a", 3, null, "b"], theme: "light" }), (p) => {
    const s = loadTuiState(p);
    expect(s.hiddenTabs).toEqual([]);
    expect(s.hiddenWidgets).toEqual(["a", "b"]);
    expect(s.theme).toBe("light"); // the other axes still load
  });
});
