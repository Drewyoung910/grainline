export const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function normalizeRequestId(
  incoming: string | null | undefined,
  generate: () => string = () => crypto.randomUUID(),
) {
  const trimmed = incoming?.trim();
  if (trimmed && REQUEST_ID_PATTERN.test(trimmed)) return trimmed;
  return generate();
}

export function requestHeadersWithRequestId(headers: Headers, requestId: string) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(REQUEST_ID_HEADER, requestId);
  return nextHeaders;
}
