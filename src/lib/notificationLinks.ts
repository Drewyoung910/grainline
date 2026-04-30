const NOTIFICATION_LINK_ORIGIN = "https://grainline.local";

export function safeNotificationPath(link: string | null | undefined): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//") || link.includes("\\")) {
    return null;
  }

  try {
    const url = new URL(link, NOTIFICATION_LINK_ORIGIN);
    if (url.origin !== NOTIFICATION_LINK_ORIGIN) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
