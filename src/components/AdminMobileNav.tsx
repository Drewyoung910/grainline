// src/components/AdminMobileNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, AlertTriangle, Shield, Edit, Rss, Eye, User, Star, File } from "@/components/icons";

const NAV_ITEMS = [
  { href: "/admin/orders",       label: "Orders",     Icon: Package },
  { href: "/admin/cases",        label: "Cases",      Icon: AlertTriangle, badgeKey: "openCaseCount" as const },
  { href: "/admin/flagged",      label: "Flagged",    Icon: AlertTriangle },
  { href: "/admin/verification", label: "Verify",     Icon: Shield, badgeKey: "pendingVerificationCount" as const },
  { href: "/admin/blog",         label: "Blog",       Icon: Edit, badgeKey: "pendingCommentCount" as const },
  { href: "/admin/broadcasts",   label: "Broadcasts", Icon: Rss },
  { href: "/admin/review",       label: "Review",     Icon: Eye, badgeKey: "pendingReviewCount" as const },
  { href: "/admin/reviews",       label: "Reviews",    Icon: Star },
  { href: "/admin/reports",      label: "Reports",    Icon: AlertTriangle },
  { href: "/admin/support",      label: "Support",    Icon: File, badgeKey: "openSupportRequestCount" as const },
  { href: "/admin/users",        label: "Users",      Icon: User },
  { href: "/admin/audit",        label: "Audit",      Icon: Shield },
];

type Counts = {
  openCaseCount: number;
  pendingVerificationCount: number;
  pendingCommentCount: number;
  pendingReviewCount: number;
  openSupportRequestCount: number;
};

export default function AdminMobileNav(counts: Counts) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="md:hidden flex overflow-x-auto border-b bg-white px-1 py-1 gap-0.5 shrink-0">
      {NAV_ITEMS.map(({ href, label, Icon, badgeKey }) => {
        const active = pathname.startsWith(href);
        const badge = badgeKey ? counts[badgeKey] : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg min-w-[56px] min-h-[44px] justify-center
              ${active
                ? "bg-neutral-900 text-white"
                : "text-neutral-700 hover:bg-neutral-100"
              }`}
          >
            <Icon size={18} />
            {/* Show label on sm+ screens; icon-only on very small */}
            <span className="text-[10px] leading-none hidden xs:block sm:block">{label}</span>
            <span className="text-[10px] leading-none sm:hidden">{label}</span>
            {badge > 0 && (
              <span className="absolute right-1 top-1 min-w-[14px] rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-4 text-white text-center">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
