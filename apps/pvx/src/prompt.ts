import { createInterface } from "node:readline/promises";

const log = (s: string) => process.stderr.write(s);

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** No echo: raw mode, Enter ends, Backspace edits, Ctrl+C aborts. Prompt goes to stderr. */
export function askSecret(name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let value = "";
    log(`${name}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const done = (v: string | undefined) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      log("\n");
      resolve(v);
    };
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString()) {
        if (ch === "\r" || ch === "\n") return done(value || undefined);
        if (ch === "\x03") return done(undefined);
        if (ch === "\x7f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}
