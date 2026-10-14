// The request side of `ctx.net` that is not about permission: the signal (caller's abort plus a timeout), the readable errors and the
// streamed multipart body. `createGranted` checks host and path first; nothing here logs a header.
import type { AbortSignalLike } from "@pvx/sdk";

export const DEFAULT_NET_TIMEOUT_MS = 30_000;

/** One signal that fires on the caller's abort or after `timeoutMs`, whichever comes first, and stays armed while the response body is read. */
export function requestSignal(external: AbortSignalLike | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeout = AbortSignal.timeout(timeoutMs);
  timeout.addEventListener("abort", () => controller.abort(timeout.reason), { once: true });
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", () => controller.abort(), { once: true });
  return controller.signal;
}

/** Says what happened in the module's words; any other error (a refused connection, a bad certificate) passes through untouched. */
export function explainNetError(error: unknown, host: string, timeoutMs: number): unknown {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") return new Error(`net ${host}: sem resposta em ${timeoutMs} ms. Aumente timeoutMs ou confira a rede`);
  if (name === "AbortError") return new Error(`net ${host}: pedido cancelado`);
  return error;
}

const ENCODER = new TextEncoder();
const LINE_END = "\r\n";

/** A header or field name goes between quotes: a quote or a line break in it would end the quote or the header. */
function quoted(value: string): string {
  return value.replaceAll('"', "%22").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export interface MultipartInit {
  /** Where the file is read from. */
  path: string;
  /** Its length now: the length the request announces. */
  size: number;
  field: string;
  filename: string;
  fields: Record<string, string>;
}

export interface MultipartBody {
  contentType: string;
  contentLength: number;
  stream: ReadableStream<Uint8Array>;
}

function fieldPart(boundary: string, name: string, value: string): string {
  return `--${boundary}${LINE_END}Content-Disposition: form-data; name="${quoted(name)}"${LINE_END}${LINE_END}${value}${LINE_END}`;
}

function fileHead(boundary: string, field: string, filename: string): string {
  const disposition = `Content-Disposition: form-data; name="${quoted(field)}"; filename="${quoted(filename)}"`;
  return `--${boundary}${LINE_END}${disposition}${LINE_END}Content-Type: application/octet-stream${LINE_END}${LINE_END}`;
}

/** The head (text fields and the file part header), the file in chunks (never more than `size` bytes), then the tail. */
async function* multipartChunks(init: MultipartInit, head: Uint8Array, tail: Uint8Array): AsyncGenerator<Uint8Array> {
  yield head;
  yield* Bun.file(init.path).slice(0, init.size).stream();
  yield tail;
}

/** A pull-based stream over the chunks: the next chunk is read only when the network asks for it, so memory stays flat. */
function streamOf(chunks: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

/** `multipart/form-data` with the text fields first and the file last, with its length known, so a server that refuses chunked bodies accepts it. */
export function multipartBody(init: MultipartInit): MultipartBody {
  const boundary = `pvx-${crypto.randomUUID()}`;
  const textFields = Object.entries(init.fields).map(([name, value]) => fieldPart(boundary, name, value));
  const head = ENCODER.encode(textFields.join("") + fileHead(boundary, init.field, init.filename));
  const tail = ENCODER.encode(`${LINE_END}--${boundary}--${LINE_END}`);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: head.byteLength + init.size + tail.byteLength,
    stream: streamOf(multipartChunks(init, head, tail)),
  };
}

const FRAMING_HEADERS = ["content-type", "content-length"];

/** The caller's headers without the two the upload sets itself (a stale length would corrupt the request). */
export function withoutFramingHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const kept = Object.entries(headers ?? {}).filter(([name]) => !FRAMING_HEADERS.includes(name.toLowerCase()));
  return Object.fromEntries(kept);
}
