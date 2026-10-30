// src/lib/adminNavState.ts
// Shared current-page matching for the admin mobile tab strip and desktop
// sidebar. A plain prefix match marks "/admin/review" as current on
// "/admin/reviews", so match the exact path or a full path-segment prefix.
export function isAdminNavItemActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
