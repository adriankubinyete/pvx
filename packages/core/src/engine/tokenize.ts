/** Shell-like split: single quotes literal, double quotes allow \" and \\, backslash escapes outside quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let q: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q === "'") {
      if (c === "'") q = null;
      else cur += c;
    } else if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && (line[i + 1] === '"' || line[i + 1] === "\\")) cur += line[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (q) throw new Error(`aspas não fechadas: ${q}`);
  if (cur || has) out.push(cur);
  return out;
}
