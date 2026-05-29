import { APP_BASE_URL } from "./appBaseUrl.ts";

const DEFAULT_APP_URL = APP_BASE_URL;

function firstQueryValue(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

function unsafeInternalPathPrefix(value: string) {
  if (CONTROL_CHAR_PATTERN.test(value)) return true;

  let pathPrefix = value.split(/[?#]/, 1)[0]?.slice(0, 64) ?? "";
  for (let pass = 0; pass < 3; pass += 1) {
    if (pathPrefix.startsWith("//") || pathPrefix.startsWith("/\\")) return true;
    if (CONTROL_CHAR_PATTERN.test(pathPrefix)) return true;

    let decoded;
    try {
      decoded = decodeURIComponent(pathPrefix);
    } catch {
      return true;
    }
    if (decoded === pathPrefix) return false;
    pathPrefix = decoded;
  }

  return pathPrefix.startsWith("//") || pathPrefix.startsWith("/\\") || CONTROL_CHAR_PATTERN.test(pathPrefix);
}

export function safeInternalPath(
  returnUrl: string | string[] | null | undefined,
  fallback = "/",
): string {
  const value = firstQueryValue(returnUrl);
  if (
    !value ||
    !value.startsWith("/") ||
    unsafeInternalPathPrefix(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://thegrainline.com");
    if (parsed.origin !== "https://thegrainline.com") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function signInPathForRedirect(returnUrl: string | string[] | null | undefined, fallback = "/") {
  const safePath = safeInternalPath(returnUrl, fallback);
  return `/sign-in?redirect_url=${encodeURIComponent(safePath)}`;
}

export function signUpPathForRedirect(returnUrl: string | string[] | null | undefined, fallback = "/") {
  const safePath = safeInternalPath(returnUrl, fallback);
  return `/sign-up?redirect_url=${encodeURIComponent(safePath)}`;
}

export function acceptTermsPathForRedirect(returnUrl: string | string[] | null | undefined, fallback = "/") {
  const safePath = safeInternalPath(returnUrl, fallback);
  if (safePath === "/accept-terms" || safePath.startsWith("/accept-terms?")) {
    return safePath;
  }
  return `/accept-terms?redirect_url=${encodeURIComponent(safePath)}`;
}

export function safeInternalReturnUrl(
  returnUrl: string | null | undefined,
  appUrl = DEFAULT_APP_URL,
): string | null {
  if (
    !returnUrl ||
    !returnUrl.startsWith("/") ||
    unsafeInternalPathPrefix(returnUrl)
  ) {
    return null;
  }

  try {
    const appOrigin = new URL(appUrl).origin;
    const parsed = new URL(returnUrl, appOrigin);
    if (parsed.origin !== appOrigin) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
