const DEFAULT_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";

function firstQueryValue(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function safeInternalPath(
  returnUrl: string | string[] | null | undefined,
  fallback = "/",
): string {
  const value = firstQueryValue(returnUrl);
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
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

export function safeInternalReturnUrl(
  returnUrl: string | null | undefined,
  appUrl = DEFAULT_APP_URL,
): string | null {
  if (
    !returnUrl ||
    !returnUrl.startsWith("/") ||
    returnUrl.startsWith("//") ||
    returnUrl.startsWith("/\\")
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
