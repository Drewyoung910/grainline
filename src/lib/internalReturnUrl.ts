const DEFAULT_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";

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
