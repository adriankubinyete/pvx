import type { ArgSpec, CommandCtx, CommandDef } from "@pvx/sdk";
import { bytes, clean, freshId, MAX_BYTES, MAX_SIGNATURE, oneLine } from "../notes.ts";
import { EVENT_VERSION } from "../state.ts";
import { appendEvent, currentUser, readEvents } from "../storage.ts";
import { TEXT } from "../texts.ts";

const ARGS: ArgSpec[] = [
  { name: "texto", label: "Nota", help: "Visível para todos os técnicos; não cole senhas", kind: "positional", required: true, stdin: true },
  { name: "assinatura", label: "Assinatura", help: "Quem escreveu (opcional)", kind: "option" },
];

/** The note text, or undefined after saying what is wrong with it. */
function validText(ctx: CommandCtx): string | undefined {
  const text = clean(ctx.arg("texto") ?? "").trim();
  if (!text) {
    ctx.out.error(TEXT.empty);
    return undefined;
  }
  if (bytes(text) > MAX_BYTES) {
    ctx.out.error(TEXT.tooLong(bytes(text), MAX_BYTES));
    return undefined;
  }
  return text;
}

/** The signature as typed, `""` when there is none, or undefined after saying it is too long. */
function validSignature(ctx: CommandCtx): string | undefined {
  const signature = oneLine(ctx.option("assinatura") ?? "");
  if ([...signature].length <= MAX_SIGNATURE) return signature;
  ctx.out.error(TEXT.signatureTooLong(MAX_SIGNATURE));
  return undefined;
}

async function run(ctx: CommandCtx): Promise<void> {
  const text = validText(ctx);
  const signature = validSignature(ctx);
  if (text === undefined || signature === undefined) return;
  const events = await readEvents(ctx.fs);
  const id = freshId(new Set(events.map((event) => event.id)));
  await appendEvent(ctx.fs, { v: EVENT_VERSION, id, at: new Date().toISOString(), ev: "add", author: currentUser(), text, ...(signature ? { signature } : {}) });
  ctx.out.success(TEXT.created(events.filter((event) => event.ev === "add").length + 1));
}

export const add: CommandDef = { help: "Cria uma nota para os outros técnicos", title: "Nova nota", args: ARGS, run };
