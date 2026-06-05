import { HTTP_STATUS } from "./httpStatus.ts";

export class RequestBodyTooLargeError extends Error {
  readonly status = HTTP_STATUS.PAYLOAD_TOO_LARGE;
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

export class InvalidJsonBodyError extends Error {
  readonly status = HTTP_STATUS.BAD_REQUEST;

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

export function assertContentLengthUnder(request: Request, maxBytes: number): void {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return;

  const parsedLength = Number.parseInt(contentLength, 10);
  if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  assertContentLengthUnder(request, maxBytes);

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

export async function readOptionalBoundedJson(
  request: Request,
  maxBytes: number,
  fallback: unknown = null,
): Promise<unknown> {
  try {
    return await readBoundedJson(request, maxBytes);
  } catch (error) {
    if (isInvalidJsonBodyError(error)) {
      return fallback;
    }
    throw error;
  }
}
