export function isListingNavigationHref(href: string | null, baseHref: string): boolean {
  if (!href) return false;
  try {
    const base = new URL(baseHref);
    const destination = new URL(href, base);
    return destination.origin === base.origin && /^\/listing\/[^/]+/.test(destination.pathname);
  } catch {
    return false;
  }
}
