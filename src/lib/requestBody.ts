export class RequestBodyTooLargeError extends Error {
  readonly status = 413;
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

export class InvalidJsonBodyError extends Error {
  readonly status = 400;

  constructor() {
    super("Invalid JSON");
    this.name = "InvalidJsonBodyError";
  }
}

export function isRequestBodyTooLargeError(error: unknown): error is RequestBodyTooLargeError {
  return error instanceof RequestBodyTooLargeError;
}

export function isInvalidJsonBodyError(error: unknown): error is InvalidJsonBodyError {
  return error instanceof InvalidJsonBodyError;
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidJsonBodyError();
  }
}
