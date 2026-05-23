export const PRIVATE_JSON_CACHE_CONTROL = "private, no-store, max-age=0";
export const PRIVATE_JSON_VARY = "Cookie";

export function privateHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set("Cache-Control", PRIVATE_JSON_CACHE_CONTROL);

  const vary = headers.get("Vary");
  if (!vary) {
    headers.set("Vary", PRIVATE_JSON_VARY);
    return headers;
  }

  const values = vary.split(",").map((value) => value.trim().toLowerCase());
  if (!values.includes("cookie")) {
    headers.set("Vary", `${vary}, ${PRIVATE_JSON_VARY}`);
  }
  return headers;
}

export function privateResponse<T extends Response>(response: T): T {
  const headers = privateHeaders(response.headers);
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export function privateJson(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: privateHeaders(init.headers),
  });
}
