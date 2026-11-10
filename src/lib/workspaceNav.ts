// The Workshop and My account sidebars: which pages get one, what it lists and
// which row is current. Plain data, so it can be tested without a browser.
export type WorkspaceKind = "workshop" | "account";

export type WorkspaceIcon =
  | "bell" | "chart" | "edit" | "eyeOff" | "grid" | "hammer" | "heart" | "message" | "package"
  | "rss" | "search" | "settings" | "shield" | "star" | "store" | "tag" | "user";

export type WorkspaceNavItem = Readonly<{
  href: string;
  label: string;
  icon: WorkspaceIcon;
  count?: number;
  countCapped?: boolean;
  // Only this exact path counts as current (the overview pages).
  exact?: boolean;
  // A link into part of another page; never shown as the current page.
  anchorOnly?: boolean;
  // Other paths that belong to this row.
  also?: readonly string[];
}>;

export type WorkspaceNavGroup = Readonly<{ label: string; items: readonly WorkspaceNavItem[] }>;

export type WorkspaceCounts = Readonly<{
  listings?: number | null;
  ordersToShip?: number | null;
  ordersToShipCapped?: boolean;
  messages?: number | null;
  notifications?: number | null;
}>;

// Long forms keep the whole screen, so a stray click can't lose a draft, and
// setup has its own wizard. A deleted account's closing page has no account.
const NO_SHELL_PATHS: readonly RegExp[] = [
  /^\/dashboard\/onboarding(\/|$)/,
  /^\/dashboard\/listings\/(new|custom)(\/|$)/,
  /^\/dashboard\/listings\/[^/]+\/edit(\/|$)/,
  /^\/dashboard\/blog\/new(\/|$)/,
  /^\/dashboard\/blog\/[^/]+\/edit(\/|$)/,
  /^\/account\/deleted(\/|$)/,
];

// These pages live under /dashboard for historical reasons but belong to the
// buyer side. Their addresses stay the same.
const BUYER_PATHS_UNDER_DASHBOARD: readonly RegExp[] = [
  /^\/dashboard\/orders(\/|$)/,
  /^\/dashboard\/notifications(\/|$)/,
  /^\/dashboard\/saved(\/|$)/,
];

export function workspaceKindForPath(pathname: string): WorkspaceKind | null {
  if (NO_SHELL_PATHS.some((pattern) => pattern.test(pathname))) return null;
  if (pathname === "/account" || pathname.startsWith("/account/")) return "account";
  if (BUYER_PATHS_UNDER_DASHBOARD.some((pattern) => pattern.test(pathname))) return "account";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "workshop";
  return null;
}

export function workshopNavGroups(input: { counts?: WorkspaceCounts; guildLabel?: string | null } = {}): WorkspaceNavGroup[] {
  const counts = input.counts ?? {};
  return [
    {
      label: "Shop",
      items: [
        { href: "/dashboard", label: "Overview", icon: "grid", exact: true },
        { href: "/dashboard/listings", label: "Listings", icon: "tag", also: ["/dashboard/inventory"] },
        {
          href: "/dashboard/sales",
          label: "Orders",
          icon: "package",
          count: counts.ordersToShip ?? undefined,
          countCapped: counts.ordersToShipCapped,
        },
        { href: "/messages", label: "Messages", icon: "message", count: counts.messages ?? undefined },
      ],
    },
    {
      label: "Grow",
      items: [
        { href: "/dashboard/analytics", label: "Analytics", icon: "chart" },
        { href: "/dashboard/seller#shop-updates", label: "Shop updates", icon: "rss", anchorOnly: true },
        { href: "/dashboard/blog", label: "Blog", icon: "edit" },
        { href: "/dashboard/verification", label: input.guildLabel || "Guild", icon: "shield" },
      ],
    },
    {
      label: "Settings",
      items: [
        { href: "/dashboard/profile", label: "Shop profile", icon: "store" },
        { href: "/dashboard/seller", label: "Shop settings", icon: "settings" },
      ],
    },
    {
      label: "Your account",
      items: [
        { href: "/dashboard/notifications", label: "Notifications", icon: "bell", count: counts.notifications ?? undefined },
        { href: "/account", label: "My account", icon: "user", exact: true },
      ],
    },
  ];
}

export function accountNavGroups(input: { counts?: WorkspaceCounts; hasSeller?: boolean | null } = {}): WorkspaceNavGroup[] {
  const counts = input.counts ?? {};
  const groups: WorkspaceNavGroup[] = [
    {
      label: "You",
      items: [
        { href: "/account", label: "Overview", icon: "grid", exact: true },
        { href: "/account/orders", label: "Orders", icon: "package", also: ["/dashboard/orders"] },
        { href: "/account/saved", label: "Saved", icon: "heart", also: ["/dashboard/saved"] },
        { href: "/account/saved-searches", label: "Saved searches", icon: "search" },
        { href: "/account/following", label: "Following", icon: "store" },
        { href: "/account/feed", label: "Your feed", icon: "rss" },
      ],
    },
    {
      label: "Community",
      items: [
        { href: "/messages", label: "Messages", icon: "message", count: counts.messages ?? undefined },
        { href: "/account/reviews", label: "Reviews", icon: "star" },
        { href: "/account/commissions", label: "Commission requests", icon: "hammer" },
      ],
    },
    {
      label: "Settings",
      items: [
        { href: "/dashboard/notifications", label: "Notifications", icon: "bell", count: counts.notifications ?? undefined },
        { href: "/account/settings", label: "Account settings", icon: "settings" },
        { href: "/account/blocked", label: "Blocked users", icon: "eyeOff" },
      ],
    },
  ];
  if (input.hasSeller === true) {
    groups.push({ label: "Your shop", items: [{ href: "/dashboard", label: "Workshop", icon: "store", exact: true }] });
  } else if (input.hasSeller === false) {
    groups.push({ label: "Sell on Grainline", items: [{ href: "/become-a-maker", label: "Start selling", icon: "store" }] });
  }
  return groups;
}

// The current row is the most specific match, so an order page lights Orders.
export function currentWorkspaceHref(pathname: string, groups: readonly WorkspaceNavGroup[]): string | null {
  let best: { href: string; length: number } | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.anchorOnly) continue;
      for (const candidate of [item.href, ...(item.also ?? [])]) {
        const matches = item.exact
          ? pathname === candidate
          : pathname === candidate || pathname.startsWith(`${candidate}/`);
        if (matches && (!best || candidate.length > best.length)) {
          best = { href: item.href, length: candidate.length };
        }
      }
    }
  }
  return best?.href ?? null;
}

// Guild state as the sidebar row names it.
export function guildNavLabel(input: { guildLevel?: string | null; verificationStatus?: string | null }): string {
  if (input.guildLevel === "GUILD_MASTER") return "Guild Master";
  if (input.guildLevel === "GUILD_MEMBER") return "Guild Member";
  return input.verificationStatus === "PENDING" ? "Guild Badge Pending" : "Apply for Guild Badge";
}
